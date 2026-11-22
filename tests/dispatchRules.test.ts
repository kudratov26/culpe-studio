// The Dispatcher rules: when the lead runs and when workers run.

import { test } from "node:test";
import assert from "node:assert/strict";

import { leadShouldStart, workerShouldStart } from "../server/dispatch";
import type { AgentConfig, Task } from "../src/data/types";

const agent = (id: string, isLead: boolean): AgentConfig => ({
  id,
  name: id,
  role: isLead ? "Lead" : "Developer",
  isLead,
  cli: "opencode",
  model: "",
  mode: "sandbox",
  color: "#29adff",
  skills: [],
  roleMd: "",
  sandbox: { resources: { cpus: null, memoryGb: null }, allow: [], deny: [] },
  workspacePath: null,
});

const task = (over: Partial<Task> = {}): Task => ({
  id: "B1-T02",
  boardId: "B1",
  title: "Write the report",
  ownerId: null,
  status: "todo",
  needs: [],
  prNumber: null,
  ...over,
});

const st = (state: string, session: string) => ({ state, session: { state: session } });

test("workerShouldStart: assigned, idle worker with no run going", () => {
  const a = agent("dwight", false);
  assert.equal(workerShouldStart(a, st("idle", "stopped"), task({ ownerId: "dwight" })), true);
  assert.equal(workerShouldStart(a, st("idle", "stopped"), task({ ownerId: "dwight", status: "in-progress" })), false);
  assert.equal(workerShouldStart(a, st("idle", "stopped"), task({ ownerId: "michael" })), false);
  assert.equal(workerShouldStart(a, st("idle", "stopped"), task({ ownerId: "dwight", prNumber: 7 })), false);
  assert.equal(workerShouldStart(a, st("idle", "running"), task({ ownerId: "dwight" })), false);
  assert.equal(workerShouldStart(a, st("idle", "starting"), task({ ownerId: "dwight" })), false);
  assert.equal(workerShouldStart(a, st("idle", "failed"), task({ ownerId: "dwight" })), false);
  assert.equal(workerShouldStart(a, st("working", "stopped"), task({ ownerId: "dwight" })), false);
  assert.equal(workerShouldStart(a, undefined, task({ ownerId: "dwight" })), false);
  assert.equal(workerShouldStart(a, st("idle", "stopped"), undefined), false);
});

test("leadShouldStart: unassigned tasks and no lead run going", () => {
  const lead = agent("michael", true);
  assert.equal(leadShouldStart(lead, { state: "stopped" }, [task()]), true);
  assert.equal(leadShouldStart(lead, { state: "stopped" }, []), false);
  assert.equal(leadShouldStart(lead, { state: "running" }, [task()]), false);
  assert.equal(leadShouldStart(lead, { state: "starting" }, [task()]), false);
  assert.equal(leadShouldStart(lead, { state: "failed" }, [task()]), false);
  assert.equal(leadShouldStart(lead, undefined, [task()]), false);
  assert.equal(leadShouldStart(undefined, { state: "stopped" }, [task()]), false);
});
