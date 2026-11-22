// The files HQ writes into each agent's folder. All of them are listed in the
// clone's .git/info/exclude, so they are never committed.

import { join } from "node:path";
import { lstatSync } from "node:fs";
import { agentRead, agentWrite } from "./lib/agentFs";
import type { AgentConfig, HqConfig } from "../src/data/types";
import { stackRoleMd } from "../src/data/stack";

/** OpenCode's project config: the HQ Team MCP server (remote), passed with the workspace. */
export const OPENCODE_CONFIG = "opencode.jsonc";
export const HQ_FILES = [OPENCODE_CONFIG];

/** Extra context for the generated role: the folder's own AGENTS.md/ROLE.md, and whether app variables are set. */
export interface RoleExtras {
  ownRole?: string | null;
  hasEnvFile?: boolean;
}

/** URL agents use to reach HQ: through the sandbox proxy, or straight to localhost. */
export function hqUrl(agent: AgentConfig, port: number): string {
  return agent.mode === "sandbox" ? `http://host.docker.internal:${port}` : `http://127.0.0.1:${port}`;
}

/** OpenCode's project config: the Team MCP server, as a remote server with this agent's token. */
export function opencodeFiles(dir: string, agent: AgentConfig, cfg: HqConfig, token: string, _extras: RoleExtras = {}) {
  const config = {
    $schema: "https://opencode.ai/config.json",
    mcp: {
      servers: {
        hq: {
          type: "remote",
          url: `${hqUrl(agent, cfg.project.hqPort)}/mcp`,
          headers: { Authorization: `Bearer ${token}`, "X-HQ-Agent": agent.id },
          oauth: false,
        },
      },
    },
  };
  agentWrite(dir, OPENCODE_CONFIG, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  excludeFromGit(dir, HQ_FILES);
}

export function opencodeRoleMd(agent: AgentConfig, cfg: HqConfig, extras: RoleExtras = {}): string {
  const team = cfg.team.map((a) => `- ${a.name} — ${a.role}${a.isLead ? " (lead)" : ""}${a.id === agent.id ? " ← you" : ""}`).join("\n");
  const rules = agent.isLead
    ? [
        "You plan the work and assign it to the team. You never write app code.",
        "Keep tasks small: one task = one branch = one PR. Give each task the files it may edit and a clear done-when.",
        "Assign only to agents that are running and free (check list_workers).",
        cfg.workflow.merge.by === "lead"
          ? "You merge PRs once they pass review (`gh pr merge <number> --squash --delete-branch`), one at a time, in an order that avoids conflicts."
          : "The user merges PRs; never merge one yourself. Decide the order they should land in, and tell the user if one blocks another.",
        "If the user changes who merges, follow the latest message.",
      ]
    : [
        "Work only on the task you were given. One task = one branch = one PR.",
        "Edit only the files the task lists. Need another file? Ask the lead with send_message.",
        "Title PRs `[TASK-ID] Short title` and open them with `gh pr create`. When the PR is open, HQ moves the task to in-review automatically — there is no need to call anything.",
        "If you cannot finish the task, stop: your run ends and the office says so. Say what you did in your final message.",
      ];
  rules.push(
    "When you need the user to do something outside the sandbox (create an account, database or API key, change a setting in a dashboard, put a value in your env file), call ask_user with a short title and clear steps. Never put secret values in it; name the variable instead.",
  );
  if (agent.mode === "sandbox")
    rules.push(
      "Your sandbox blocks most websites and APIs. If a request you need is blocked (a docs page or an API: usually a 403 saying 'Approval required for <host>'), call request_access with the domain and why, then continue with other work until HQ tells you it was answered. Never work around the block.",
    );
  const tools = agent.isLead
    ? "list_workers, get_status, list_tasks, create_board, create_task, update_task, assign_task, send_message, ask_user, request_access"
    : "get_my_task, set_my_status, list_workers, get_status, list_tasks, send_message, ask_user, request_access";
  return [
    `# ${agent.name} — ${agent.role}`,
    "",
    agent.roleMd.trim(),
    "",
    "## Team",
    team,
    "",
    "## Rules",
    ...rules.map((r) => `- ${r}`),
    "",
    ...(stackRoleMd(cfg.stack) ? [stackRoleMd(cfg.stack), ""] : []),
    ...(extras.hasEnvFile
      ? [
          "## App variables",
          "Your session already has this project's app variables (from HQ's env file) as environment variables. See the names with `printenv | cut -d= -f1`; never print or commit the values. Code reads them from the environment as usual.",
          "",
        ]
      : []),
    ...(extras.ownRole?.trim() ? ["## From AGENTS.md in this folder", extras.ownRole.trim(), ""] : []),
    "## Team MCP (server `hq`)",
    `Your tools: ${tools}.`,
    "Messages that start with `[HQ]` come from HQ: assignments from the lead, or messages from teammates. Act on them.",
    "Teammates work in their own sandboxes and cannot see your files or terminal. Talk to them only with send_message.",
    "",
    `Project: ${cfg.project.name} (${cfg.project.repo}). You are managed by jsm-hq-opencode.`,
    "",
  ].join("\n");
}

// Adds paths to .git/info/exclude (a per-clone .gitignore that is never committed).
export function excludeFromGit(dir: string, paths: string[]) {
  // Only a real .git folder (a worktree's .git is a file; a symlink isn't followed).
  try {
    if (!lstatSync(join(dir, ".git")).isDirectory()) return;
  } catch {
    return;
  }
  const file = ".git/info/exclude";
  const current = agentRead(dir, file) ?? "";
  const missing = paths.filter((p) => !current.split("\n").includes(p));
  if (missing.length) agentWrite(dir, file, current + (current.endsWith("\n") || !current ? "" : "\n") + "# jsm-hq-opencode\n" + missing.join("\n") + "\n");
}
