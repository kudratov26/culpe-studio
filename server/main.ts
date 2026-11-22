// jsm-hq-opencode — run the orchestration for the git repo you're in.
//
//   jsm-hq-opencode [--repo <path>] [--port 7420] [--dev] [--no-open]
//
// --dev: the UI is served by Vite (pnpm dev:hq); HQ prints/opens the Vite URL.
//
// Agents are OpenCode: the lead and each worker each run one `opencode run --auto`
// per task in their workspace/sandbox, and the office shows the pixel-art office.

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeCommands } from "./commands";
import { startHttp } from "./http";
import { Hub } from "./hub";
import { GitHubSync } from "./githubSync";
import { Inbox } from "./inbox";
import { Planner } from "./planner";
import { ActionItems } from "./actionItems";
import { Sbx } from "./sbx";
import { run } from "./lib/exec";
import { log } from "./lib/log";
import { agentToken, browserToken } from "./paths";
import { detectRepo } from "./repo";
import { Dispatcher } from "./dispatch";
import { Sessions } from "./sessions";
import { runSetupChecks } from "./setup";
import { loadConfig, loadPlan } from "./store";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const dev = flag("dev");
  const port = Number(arg("port") ?? process.env.HQ_PORT ?? 7420);
  const repo = await detectRepo(resolve(arg("repo") ?? process.env.HQ_REPO ?? process.cwd()));
  const { config, isNew } = loadConfig(repo, port);
  config.project.hqPort = port;
  const slug = config.project.id;
  const token = agentToken(slug);
  const uiToken = browserToken(slug, dev);

  log.info(`repo   ${repo.root}${repo.github ? `  (github.com/${repo.github})` : ""}`);
  log.info("checking setup…");
  const setup = await runSetupChecks(repo);
  for (const c of setup.checks) log.info(`  ${c.status === "ok" ? "✓" : c.status === "warning" ? "!" : "✗"} ${c.label}: ${c.detail}`);

  const hub = new Hub(repo, slug, config, loadPlan(repo.root), setup);
  hub.snap.welcome = isNew;
  const sessions = new Sessions(hub, token);
  const inbox = new Inbox(hub);
  const planner = new Planner(hub, inbox);
  const dispatcher = new Dispatcher(hub, planner, sessions, inbox);
  planner.actions = new ActionItems(hub, planner);

  const sbx = new Sbx(hub);
  sessions.envFileFor = (id) => (existsSync(sbx.envFile(id)) ? sbx.envFile(id) : null);
  sessions.onSessionDown = (id) => {
    void sbx.refreshPorts(id);
  };
  sessions.onSandboxRemoved = (id) => {
    void sbx.refreshPorts(id);
  };

  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const distDir = join(root, "dist");
  const uiPort = Number(process.env.HQ_UI_PORT ?? 5173);
  const uiOrigin = dev ? `http://localhost:${uiPort}` : `http://127.0.0.1:${port}`;
  if (!dev && !existsSync(join(distDir, "index.html"))) log.warn("No built UI found. Run `pnpm build` first, or use `pnpm dev:hq`.");

  await startHttp({
    hub,
    planner,
    port,
    browserToken: uiToken,
    agentToken: token,
    distDir: dev ? null : distDir,
    allowedOrigins: [uiOrigin, `http://127.0.0.1:${uiPort}`, `http://localhost:${port}`, `http://127.0.0.1:${port}`],
    commands: makeCommands(hub, dispatcher, sessions, planner, inbox, sbx),
  });
  dispatcher.start();
  sessions.startPolling();
  sbx.startApprovalPolling();
  const github = new GitHubSync(hub, planner, repo.github);
  github.start();

  const url = `${uiOrigin}/?token=${uiToken}`;
  log.info(`\n\n  jsm-hq-opencode is running → ${url}\n`);
  if (!flag("no-open")) {
    const [opener, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]] : ["xdg-open", [url]];
    setTimeout(() => void run(opener, args), dev ? 1500 : 0);
  }

  const quit = () => {
    log.info(sessions.backend.persistent ? "stopping HQ — agent sessions keep running" : "stopping HQ — agent runs stop; sandboxes and folders are kept");
    sessions.shutdown();
    sbx.stopApprovalPolling();
    github.stop();
    dispatcher.stop();
    process.exit(0);
  };
  process.on("SIGINT", quit);
  process.on("SIGTERM", quit);
}

main().catch((err) => {
  if ((err as NodeJS.ErrnoException)?.code === "EADDRINUSE") {
    log.error(`Port ${arg("port") ?? 7420} is in use — another HQ may be running. Stop it, or pick another port: jsm-hq-opencode --port 7421`);
    process.exit(1);
  }
  log.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
