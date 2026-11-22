// Prompts that start OpenCode workers and the lead, and the gh-based PR matching.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";

import { matches } from "../server/opencodePr";
import { leadPrompt, workerBranch, workerPrompt } from "../server/opencode/prompt";
import { opencodeFiles, opencodeRoleMd } from "../server/agentFiles";
import type { AgentConfig, HqConfig, Task } from "../src/data/types";

const agent = (id: string, isLead: boolean): AgentConfig => ({
  id,
  name: id === "michael" ? "Michael" : id === "dwight" ? "Dwight" : "Worker",
  role: isLead ? "Lead" : "Developer",
  isLead,
  cli: "opencode",
  model: "",
  mode: "sandbox",
  color: "#29adff",
  skills: [],
  roleMd: `You are ${id}'s person.`,
  sandbox: { resources: { cpus: null, memoryGb: null }, allow: [], deny: [] },
  workspacePath: null,
});

const cfg = (): HqConfig => ({
  project: { id: "proj", name: "Proj", repo: "you/proj", path: "/tmp/proj", hqPort: 7420 },
  team: [agent("michael", true), agent("dwight", false)],
  workflow: {
    review: { enabled: true, tool: "human", command: "" },
    merge: { by: "human" },
    deploy: { enabled: false, tool: "instacloud", command: "", perAgentEnvironments: false },
  },
});

const task = (over: Partial<Task> = {}): Task => ({
  id: "B1-T02",
  boardId: "B1",
  title: "Write the report",
  ownerId: null,
  status: "todo",
  needs: [],
  prNumber: null,
  description: "Compile the weekly report.",
  files: ["docs/report.md"],
  doneWhen: "docs/report.md exists and is committed",
  ...over,
});

test("workerPrompt carries the task, conventions and role", () => {
  const p = workerPrompt(agent("dwight", false), cfg(), task({ ownerId: "dwight" }), null);
  assert.match(p, /You are dwight's person\./);
  assert.match(p, /## Assigned task B1-T02 — Write the report/);
  assert.match(p, /Compile the weekly report\./);
  assert.match(p, /Files you may edit[\s\S]*docs\/report\.md/);
  assert.match(p, /Done when: docs\/report\.md exists and is committed/);
  assert.match(p, /the branch hq-B1-T02/);
  assert.match(p, /\[B1-T02\] Write the report/);
  assert.match(p, /Title PRs/);
});

test("workerPrompt appends queued messages", () => {
  const p = workerPrompt(agent("dwight", false), cfg(), task({ ownerId: "dwight" }), "[HQ] Message from Michael: start early");
  assert.match(p, /You also got messages while running:\n\[HQ\] Message from Michael: start early/);
});

test("workerBranch follows the task id", () => {
  assert.equal(workerBranch("B1-T02"), "hq-B1-T02");
});

test("leadPrompt lists unassigned tasks and the tools", () => {
  const p = leadPrompt(agent("michael", true), cfg(), [task(), task({ id: "B1-T03" }), task({ id: "B1-T04", ownerId: "dwight" })], null);
  assert.match(p, /- B1-T02 — Write the report/);
  assert.match(p, /- B1-T03 — Write the report/);
  assert.match(p, /assign_task/);
  assert.match(p, /- Michael — Lead \(lead\)/);
  assert.match(p, /Compile the weekly report\./);
  assert.doesNotMatch(p, /B1-T04/);
});

test("opencodeFiles writes the opencode.jsonc project config (remote hq MCP)", () => {
  const dir = "/tmp/opencode-test-dir";
  mkdirSync(dir, { recursive: true });
  opencodeFiles(dir, agent("dwight", false), cfg(), "tok123");
  const text = readFileSync(`${dir}/opencode.jsonc`, "utf8");
  const config = JSON.parse(text);
  assert.equal(config.mcp.servers.hq.type, "remote");
  assert.equal(config.mcp.servers.hq.url, "http://host.docker.internal:7420/mcp");
  assert.equal(config.mcp.servers.hq.headers.Authorization, "Bearer tok123");
  assert.equal(config.mcp.servers.hq.headers["X-HQ-Agent"], "dwight");
  assert.equal(config.mcp.servers.hq.oauth, false);
  assert.ok(text.includes('"$schema": "https://opencode.ai/config.json"'));
});

test("opencodeRoleMd has the team, the rules and the project line", () => {
  const md = opencodeRoleMd(agent("dwight", false), cfg());
  assert.match(md, /## Team\n- Michael — Lead \(lead\)\n- Dwight — Developer ← you/);
  assert.match(md, /Work only on the task you were given/);
  assert.match(md, /You are managed by jsm-hq-opencode\./);
  assert.match(md, /Your tools: get_my_task, set_my_status, list_workers/);
});

// ---------------------------------------------------------------- PR matching

test("matches() matches PRs by title prefix or branch", () => {
  const pr = (title: string, headRefName: string) => ({ title, headRefName });
  assert.equal(matches(pr("[B1-T02] Write the report", "anything"), "b1-t02"), true);
  assert.equal(matches(pr("[B1-T02] Write the report", "x"), "B1-T02"), true);
  assert.equal(matches(pr("Some other PR", "hq-B1-T02-old"), "B1-T02"), true);
  assert.equal(matches(pr("[B1-T02] Write the report", "unrelated"), "B1-T05"), false);
  assert.equal(matches(pr("Unrelated", "hq-B1-T03"), "B1-T02"), false);
});
