// Agent sessions: OpenCode one-shot workers. Their "terminal" views are tails
// of each agent's hq-agent.log (backends/opencode.ts). Status comes from the
// run itself: the exit code, and runEnded (the Dispatcher) records the PR.
// There is no screen to reconcile and no typed input.

import { spawn as spawnPty, type IPty } from "@lydell/node-pty";
import { existsSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, sep } from "node:path";
import { HOST_TERMINAL, type WorkspaceInfo } from "../src/data/types";
import { opencodeFiles } from "./agentFiles";
import { opencodeSandboxSpec } from "./opencode/spec";
import type { Hub } from "./hub";
import { sessionBackend, type SessionBackend, type TermHandle } from "./backends";
import { run } from "./lib/exec";
import { log } from "./lib/log";
import { sandboxList } from "./lib/json";
import { projectHome, sessionName } from "./paths";
import { POLICY_NOT_INITIALIZED, policyVerdict, runSetupChecks } from "./setup";
import { ensureWorkspace, workspaceFor } from "./workspace";

/** sbx's opener inside a sandbox: npm's `open` ignores xdg-open unless BROWSER says so. */
const SANDBOX_BROWSER = "/usr/local/bin/xdg-open";
const SHELL_ENV = { ...process.env, TERM: "xterm-256color", FORCE_HYPERLINK: "1" } as Record<string, string>;
const SANDBOX_SHELL = `export FORCE_HYPERLINK=1; [ -x ${SANDBOX_BROWSER} ] && export BROWSER=${SANDBOX_BROWSER}; command -v bash >/dev/null && exec bash -l || exec sh -l`;

export class Sessions {
  readonly backend: SessionBackend = sessionBackend();
  private terms = new Map<string, TermHandle>();
  private shells = new Map<string, IPty>();
  private closing = new WeakSet<IPty>();
  private shellGen = new Map<string, number>();
  private sizes = new Map<string, { cols: number; rows: number }>();
  private polling: NodeJS.Timeout | null = null;
  /** Called when an agent's sandbox is removed (or recreated): what was attached to it is gone. */
  onSandboxRemoved: (agentId: string) => void = () => {};

  /** Called whenever an agent's run goes away (stop, crash, runEnded). */
  onSessionDown: (agentId: string) => void = () => {};
  /** The agent's env file, if it has one. */
  envFileFor: (agentId: string) => string | null = () => null;
  private hostShellDir: string | null = null;

  constructor(private hub: Hub, private agentToken: string) {}

  private name(agentId: string) {
    return sessionName(this.hub.slug, agentId);
  }

  // ------------------------------------------------------------ lifecycle

  async start(id: string, prompt: string) {
    const hub = this.hub;
    const agent = hub.cfg(id);
    const st = hub.status(id);
    if (!agent || !st || st.session.state === "running" || st.session.state === "starting") return;
    const setup = hub.snap.setup;
    const fail = (detail: string) => {
      hub.setSession(id, { state: "failed", detail });
      hub.setStatus(id, { state: "idle", note: "Could not start" });
      hub.activity("session", id, `${agent.name} could not start: ${detail.split("\n")[0]}`);
    };
    if (!setup.checks.find((c) => c.id === "opencode" && c.status === "ok")) return fail("OpenCode isn't installed. See the setup checklist.");
    if (agent.mode === "sandbox" && !setup.sandboxReady) return fail("Docker Sandboxes isn't ready on this machine. Finish the setup checklist, or set this agent to Local mode.");
    const name = this.name(id);
    this.onSessionDown(id);
    try {
      hub.setSession(id, { state: "starting", detail: "Preparing folder…", workspace: workspaceFor(agent, hub.slug) });
      const dir = await ensureWorkspace(agent, hub.slug, hub.repo);
      opencodeFiles(dir, agent, hub.snap.config, this.agentToken);
      if (agent.mode === "sandbox" && !(await this.backend.exists(name))) {
        hub.setSession(id, { detail: "Starting sandbox…" });
        await this.ensurePolicy();
        const spec = opencodeSandboxSpec(name, dir, agent.sandbox.resources, this.envFileFor(id));
        await this.backend.create(name, dir, spec, { cols: 200, rows: 50 });
      }
      await this.backend.spawnRun(name, dir, prompt);
      this.attach(id);
      hub.setSession(id, { state: "running", detail: null, workspace: dir });
      hub.activity("session", id, `${agent.name} started (OpenCode, ${agent.mode === "sandbox" ? "Docker Sandbox" : "Local mode"})`);
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  }

  async stop(id: string) {
    const hub = this.hub;
    const agent = hub.cfg(id);
    if (!agent) return;
    const name = this.name(id);
    this.onSessionDown(id);
    this.detach(id);
    this.closeShell(id);
    await this.backend.kill(name);
    // Stop (not remove) the sandbox so it can resume later with its state.
    if (agent.mode === "sandbox") void run("sbx", ["stop", name], { timeoutMs: 30_000 });
    hub.setSession(id, { state: "stopped", detail: null });
    hub.setStatus(id, { state: "idle", currentTaskId: null, note: "Stopped" });
    hub.activity("session", id, `${agent.name} stopped`);
  }

  /** What removing this agent would delete: folder state and whether a sandbox exists. */
  async inspectWorkspace(id: string): Promise<WorkspaceInfo | null> {
    const agent = this.hub.cfg(id);
    if (!agent) return null;
    const dir = workspaceFor(agent, this.hub.slug);
    const exists = existsSync(dir);
    let changedFiles = 0;
    let unpushedCommits = 0;
    if (exists) {
      const status = await run("git", ["status", "--porcelain"], { cwd: dir });
      changedFiles = status.stdout.split("\n").filter(Boolean).length;
      const log = await run("git", ["log", "--oneline", "--branches", "--not", "--remotes"], { cwd: dir });
      unpushedCommits = log.stdout.split("\n").filter(Boolean).length;
    }
    const name = this.name(id);
    const ls = await run("sbx", ["ls", "--json"], { timeoutMs: 10_000 });
    let sandboxExists = false;
    try {
      sandboxExists = ls.ok && (sandboxList(ls.stdout) ?? []).some((s) => s.name === name);
    } catch {
      /* sbx unavailable */
    }
    return { agentId: id, path: dir, managed: !agent.workspacePath, exists, changedFiles, unpushedCommits, sandboxName: name, sandboxExists };
  }

  /** Stops the agent and deletes what was asked. Only HQ-made folders inside HQ's home can be deleted. */
  async removeResources(id: string, opts: { deleteSandbox: boolean; deleteFolder: boolean }): Promise<string[]> {
    const agent = this.hub.cfg(id);
    if (!agent) return [];
    const done: string[] = [];
    const name = this.name(id);
    this.onSessionDown(id);
    this.detach(id);
    this.closeShell(id);
    await this.backend.kill(name);
    if (opts.deleteSandbox) {
      const rm = await run("sbx", ["rm", "-f", name], { timeoutMs: 60_000 });
      if (rm.ok) {
        done.push("sandbox");
        this.onSessionDown(id);
        this.onSandboxRemoved(id);
      } else if (!/not found|no such/i.test(rm.stderr)) log.warn(`sbx rm ${name}: ${rm.stderr.trim()}`);
    } else if (agent.mode === "sandbox") void run("sbx", ["stop", name], { timeoutMs: 30_000 });
    if (opts.deleteFolder && !agent.workspacePath) {
      const home = resolve(projectHome(this.hub.slug));
      const dir = resolve(workspaceFor(agent, this.hub.slug));
      if (dir.startsWith(home + sep) && dir !== home && existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
        done.push("folder");
      }
    }
    return done;
  }

  /** Removes the agent's sandbox and starts a fresh one (applies new CPU/memory). The folder is kept. */
  async recreate(id: string) {
    const agent = this.hub.cfg(id);
    if (!agent || agent.mode !== "sandbox") return;
    const name = this.name(id);
    if (this.hub.status(id)?.session.state === "running") await this.stop(id);
    this.hub.setSession(id, { state: "starting", detail: "Removing the old sandbox…", sandbox: null });
    const rm = await run("sbx", ["rm", "-f", name], { timeoutMs: 60_000 });
    if (!rm.ok && !/not found|no such/i.test(rm.stderr)) {
      this.hub.setSession(id, { state: "failed", detail: `sbx rm failed: ${rm.stderr.trim()}` });
      return;
    }
    this.onSessionDown(id);
    this.hub.setSession(id, { state: "stopped", detail: null });
    this.hub.activity("session", id, `Recreated ${agent.name}'s sandbox. Press Start to launch its run again.`);
  }

  /** Reads each agent's real CPU/memory from `sbx ls --json`. */
  async refreshSandboxSizes() {
    const r = await run("sbx", ["ls", "--json"], { timeoutMs: 10_000 });
    if (!r.ok) return;
    let list: { name: string; cpus?: number; memory_mib?: number }[] = [];
    try {
      list = sandboxList<(typeof list)[number]>(r.stdout) ?? [];
    } catch {
      return;
    }
    for (const agent of this.hub.snap.config.team) {
      const found = list.find((s) => s.name === this.name(agent.id));
      const m = this.hub.snap.setup.machine;
      const size = !found
        ? null
        : found.cpus && found.memory_mib
          ? { cpus: found.cpus, memoryGb: Math.round((found.memory_mib / 1024) * 10) / 10 }
          : { cpus: m.cpus, memoryGb: Math.min(32, Math.max(0.5, m.memoryGb / 2)) };
      const cur = this.hub.status(agent.id)?.session.sandbox;
      if (JSON.stringify(cur ?? null) !== JSON.stringify(size)) this.hub.setSession(agent.id, { sandbox: size });
    }
  }

  /**
   * Lets sandboxes reach HQ's port (checked once per run, added only if missing).
   * The sandbox proxy evaluates host.docker.internal as localhost, so both are allowed.
   */
  private async ensurePolicy() {
    const port = this.hub.snap.config.project.hqPort;
    for (const target of [`localhost:${port}`, `host.docker.internal:${port}`]) {
      if ((await policyVerdict(target)).verdict === "allowed") continue;
      const add = await run("sbx", ["policy", "allow", "network", target], { timeoutMs: 10_000 });
      if (!add.ok && POLICY_NOT_INITIALIZED.test(add.stderr + add.stdout))
        throw new Error("Docker Sandboxes needs a base network policy first. Open the setup checklist → “Sandbox network policy”, or run: sbx policy init balanced");
      if (!add.ok) throw new Error(`Could not allow ${target}: ${add.stderr.trim()}`);
      log.info(`added sandbox network rule: allow ${target}`);
    }
  }

  // ------------------------------------------------------------ terminals

  private attach(id: string) {
    if (this.terms.has(id)) return;
    const size = this.sizes.get(id) ?? { cols: 120, rows: 36 };
    const term: TermHandle = this.backend.attach(
      this.name(id),
      size,
      (d) => this.hub.terminal(id, d),
      () => {
        if (this.terms.get(id) === term) this.terms.delete(id);
      },
    );
    this.terms.set(id, term);
  }

  private detach(id: string) {
    this.terms.get(id)?.close();
    this.terms.delete(id);
  }

  input(id: string, data: string) {
    if (id.startsWith("shell:")) return this.shells.get(id)?.write(data);
    // Agents are one-shot: their terminals are read-only log tails.
    this.terms.get(id)?.write(data);
  }

  resize(id: string, cols: number, rows: number) {
    const c = Math.max(20, Math.min(400, Math.floor(cols)));
    const r = Math.max(5, Math.min(200, Math.floor(rows)));
    const same = this.sizes.get(id)?.cols === c && this.sizes.get(id)?.rows === r;
    this.sizes.set(id, { cols: c, rows: r });
    const pty = this.shells.get(id) ?? this.terms.get(id);
    if (!pty) return;
    const safeResize = (cs: number, rs: number) => {
      try {
        pty.resize(cs, rs);
      } catch {
        /* it closed in between */
      }
    };
    safeResize(c, r);
    if (same) setTimeout(() => safeResize(c, r), 60);
  }

  async openWorkspace(id: string) {
    const st = this.hub.status(id);
    const agent = this.hub.cfg(id);
    const dir = st?.session.workspace ?? (agent ? workspaceFor(agent, this.hub.slug) : null);
    if (!dir) return;
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
    await run(opener, [dir], { timeoutMs: 5000 });
  }

  // ------------------------------------------------------------ health

  /** Keeps state honest: picks up runs that were missed, notices dead ones. */
  startPolling() {
    const tick = async () => {
      for (const agent of this.hub.snap.config.team) {
        const st = this.hub.status(agent.id);
        if (!st || st.session.state === "starting") continue;
        const name = this.name(agent.id);
        const alive = await this.backend.exists(name);
        if (alive) {
          this.attach(agent.id);
        } else if (st.session.state === "running") {
          this.detach(agent.id);
          this.closeShell(agent.id);
          this.onSessionDown(agent.id);
          this.hub.setSession(agent.id, { state: "stopped", detail: null });
          this.hub.setStatus(agent.id, { state: "idle", note: "Stopped" });
        }
      }
    };
    void tick();
    this.polling = setInterval(() => {
      void tick().catch((e) => log.warn("poll:", e));
    }, 3000);
  }

  // ------------------------------------------------------------ setup helper

  async recheckSetup() {
    this.hub.setSetup(await runSetupChecks(this.hub.repo));
  }

  /** Runs a program in a terminal the browser can watch (id must start with "setup:"). */
  runTerminal(id: string, file: string, args: string[], onExit: (code: number) => void = () => {}) {
    if (!id.startsWith("setup:") || this.shells.has(id)) return;
    const size = this.sizes.get(id) ?? { cols: 100, rows: 16 };
    const pty = spawnPty(file, args, { name: "xterm-256color", cols: size.cols, rows: size.rows, cwd: this.hub.repo.root, env: { ...SHELL_ENV, TERM: "xterm-256color" } });
    this.shells.set(id, pty);
    this.hub.terminal(id, `\x1b[2m$ ${[file, ...args].join(" ")}\x1b[0m\r\n`);
    pty.onData((d) => this.hub.terminal(id, d));
    pty.onExit(({ exitCode }) => {
      this.shells.delete(id);
      this.hub.terminal(id, `\r\n\x1b[${exitCode === 0 ? "32m✓ Done" : `31m✗ Exited with code ${exitCode}`}\x1b[0m\r\n`);
      onExit(exitCode);
    });
  }

  /** Runs a check's fix command in a visible terminal. Only commands HQ itself suggested. */
  runFix(checkId: string) {
    const check = this.hub.snap.setup.checks.find((c) => c.id === checkId);
    if (!check?.fix?.runnable || !check.fix.command) return;
    const id = `setup:${checkId}`;
    if (this.shells.has(id)) return;
    const shell = process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "/bin/sh";
    const args = process.platform === "win32" ? ["-NoProfile", "-Command", check.fix.command] : ["-lc", check.fix.command];
    const size = this.sizes.get(id) ?? { cols: 100, rows: 16 };
    const pty = spawnPty(shell, args, { name: "xterm-256color", cols: size.cols, rows: size.rows, cwd: this.hub.repo.root, env: { ...SHELL_ENV, TERM: "xterm-256color" } });
    this.shells.set(id, pty);
    this.hub.terminal(id, `\x1b[2m$ ${check.fix.command}\x1b[0m\r\n`);
    pty.onData((d) => this.hub.terminal(id, d));
    pty.onExit(({ exitCode }) => {
      this.shells.delete(id);
      this.hub.terminal(id, `\r\n\x1b[${exitCode === 0 ? "32m✓ Done" : `31m✗ Exited with code ${exitCode}`}\x1b[0m\r\n`);
      void this.recheckSetup();
    });
  }

  // ------------------------------------------------------------ shell tab

  /**
   * Opens a shell for the "Shell" tab: `sbx exec -it <sandbox> sh -c '…'` in a
   * sandboxed agent, or the user's own shell in its folder for Local mode. It
   * runs beside the agent's run, so the agent keeps working; it closes when
   * you close it or HQ stops.
   */
  async openShell(agentId: string) {
    const id = `shell:${agentId}`;
    const agent = this.hub.cfg(agentId);
    const st = this.hub.status(agentId);
    if (!agent || this.shells.has(id)) return;
    if (st?.session.state !== "running") return this.hub.terminal(id, "\x1b[2mStart the agent first; the shell opens inside its sandbox.\x1b[0m\r\n");
    const gen = (this.shellGen.get(id) ?? 0) + 1;
    this.shellGen.set(id, gen);
    const dir = st.session.workspace ?? workspaceFor(agent, this.hub.slug);
    let pty: IPty;
    let banner: string;
    try {
      if (agent.mode === "sandbox") {
        const name = this.name(agentId);
        banner = `sbx exec -it ${name} sh`;
        pty = spawnPty("sbx", ["exec", "-it", "-w", dir, name, "sh", "-c", SANDBOX_SHELL], { name: "xterm-256color", cwd: dir, env: SHELL_ENV });
      } else {
        const sh = process.env.SHELL || "/bin/sh";
        banner = `${sh} in ${dir}`;
        pty = spawnPty(sh, ["-l"], { name: "xterm-256color", cwd: dir, env: SHELL_ENV });
      }
    } catch (err) {
      return this.hub.terminal(id, `\x1b[31mCouldn't open a shell: ${err instanceof Error ? err.message : String(err)}\x1b[0m\r\n`);
    }
    if (this.shellGen.get(id) !== gen || this.shells.has(id) || this.hub.status(agentId)?.session.state !== "running") {
      pty.kill();
      return;
    }
    this.shells.set(id, pty);
    this.hub.terminal(id, `\x1b[2m$ ${banner}\x1b[0m\r\n`);
    const startedAt = Date.now();
    pty.onData((d) => this.hub.terminal(id, d));
    pty.onExit(({ exitCode }) => {
      if (this.shells.get(id) === pty) this.shells.delete(id);
      if (exitCode && Date.now() - startedAt < 2500)
        return this.hub.terminal(id, `\r\n\x1b[31m[couldn't start the shell (exit ${exitCode}). ${agent.mode === "sandbox" ? "Check that sbx is installed and you're signed in (sbx login)." : "Check your shell."}]\x1b[0m\r\n`);
      this.hub.terminal(id, `\r\n\x1b[2m[shell closed${exitCode ? ` (exit ${exitCode})` : ""}. Press "New shell" to open another.]\x1b[0m\r\n`);
    });
  }

  closeShell(agentId: string) {
    const id = `shell:${agentId}`;
    this.shellGen.set(id, (this.shellGen.get(id) ?? 0) + 1);
    const pty = this.shells.get(id);
    if (!pty) return;
    this.closing.add(pty);
    pty.kill();
    this.shells.delete(id);
  }

  /**
   * The Terminal panel: your own shell on this machine (not in a sandbox), in
   * the folder you pick. Reopening with the same folder keeps the shell.
   */
  openHostShell(dir: string, fresh: boolean) {
    const id = HOST_TERMINAL;
    const want = this.hostDir(dir);
    if (!want) return this.hub.terminal(id, `\x1b[31mNo such folder: ${dir}\x1b[0m\r\n`);
    if (this.shells.has(id) && !fresh && want === this.hostShellDir) return;
    if (this.shells.has(id)) this.hub.terminal(id, "\x1bc");
    this.closeHostShell();
    const win = process.platform === "win32";
    const sh = win ? "powershell.exe" : process.env.SHELL || "/bin/sh";
    const size = this.sizes.get(id) ?? { cols: 100, rows: 30 };
    let pty: IPty;
    try {
      pty = spawnPty(sh, win ? ["-NoLogo"] : ["-l"], { name: "xterm-256color", cols: size.cols, rows: size.rows, cwd: want, env: SHELL_ENV });
    } catch (err) {
      return this.hub.terminal(id, `\x1b[31mCouldn't open a shell: ${err instanceof Error ? err.message : String(err)}\x1b[0m\r\n`);
    }
    this.shells.set(id, pty);
    this.hostShellDir = want;
    this.hub.terminal(id, `\x1b[2m$ ${sh} in ${want}\x1b[0m\r\n`);
    pty.onData((d) => this.hub.terminal(id, d));
    pty.onExit(({ exitCode }) => {
      if (this.shells.get(id) === pty) this.shells.delete(id);
      if (this.closing.has(pty)) return;
      this.hub.terminal(id, `\r\n\x1b[2m[shell closed${exitCode ? ` (exit ${exitCode})` : ""}. Press "New shell" to open another.]\x1b[0m\r\n`);
    });
  }

  closeHostShell() {
    const pty = this.shells.get(HOST_TERMINAL);
    this.hostShellDir = null;
    if (!pty) return;
    this.closing.add(pty);
    pty.kill();
    this.shells.delete(HOST_TERMINAL);
  }

  private hostDir(dir: string): string | null {
    const raw = dir.trim();
    if (!raw) return this.hub.repo.root;
    const full = resolve(this.hub.repo.root, raw === "~" || raw.startsWith("~/") ? homedir() + raw.slice(1) : raw);
    try {
      return statSync(full).isDirectory() ? full : null;
    } catch {
      return null;
    }
  }

  shutdown() {
    for (const p of this.shells.values()) p.kill();
    if (this.polling) clearInterval(this.polling);
    for (const t of this.terms.values()) t.close();
    this.backend.shutdown();
  }
}
