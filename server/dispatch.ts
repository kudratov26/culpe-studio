// The dispatcher: the lead plans when work arrives, and each worker runs when
// its task is assigned to it. With one-shot OpenCode runs:
//
//   Lead rule: unassigned tasks are new work; when there are some and no lead
//   run is going, one lead wave starts. `leadSeen` marks tasks the lead was
//   offered so a run that ends without assigning anything doesn't loop.
//
//   Worker rule: a task assigned to a worker (status "todo", owner set) starts
//   when the worker is idle with no run going.
//
// Run endings are noticed here (Sessions.startPolling → tick): PR →
// in-review; error → needs-input; clean end → idle ("Finished — no PR opened").

import type { AgentConfig, Task } from "../src/data/types";
import type { Hub } from "./hub";
import type { Inbox } from "./inbox";
import { findPr } from "./opencodePr";
import { leadPrompt, workerPrompt } from "./opencode/prompt";
import type { Planner } from "./planner";
import type { Sessions } from "./sessions";

/** Worker rule: start when its task is assigned and the agent is idle with no run going. */
export function workerShouldStart(
  agent: AgentConfig,
  st: { state: string; session: { state: string } } | undefined,
  task: Task | undefined,
): boolean {
  return (
    !!agent &&
    !!st &&
    !!task &&
    task.ownerId === agent.id &&
    task.status === "todo" &&
    !task.prNumber &&
    st.state === "idle" &&
    st.session.state !== "running" &&
    st.session.state !== "starting" &&
    st.session.state !== "failed"
  );
}

/** Lead rule: there are unassigned tasks and no lead run is going. */
export function leadShouldStart(lead: AgentConfig | undefined, session: { state: string } | undefined, unassigned: Task[]): boolean {
  return !!lead && unassigned.length > 0 && !!session && session.state !== "running" && session.state !== "starting" && session.state !== "failed";
}

export class Dispatcher {
  /** Unowned todo tasks the lead has been offered (so it doesn't loop on the same work). */
  private leadSeen = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private hub: Hub, private planner: Planner, private sessions: Sessions, private inbox: Inbox) {}

  start() {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), 2000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    const team = this.hub.snap.config.team;
    const unassigned = this.hub.snap.tasks.filter((t) => t.status === "todo" && t.ownerId == null);
    // Forget offers for tasks that got owners or left the board.
    for (const id of this.leadSeen) if (!unassigned.some((t) => t.id === id)) this.leadSeen.delete(id);

    // Lead: unassigned work that no lead has been offered yet.
    const unseen = unassigned.filter((t) => !this.leadSeen.has(t.id));
    const lead = team.find((a) => a.isLead);
    if (lead && unseen.length) {
      const st = this.hub.status(lead.id);
      if (leadShouldStart(lead, st?.session, unassigned)) {
        unseen.forEach((t) => this.leadSeen.add(t.id));
        void this.startAgent(lead.id);
      }
    }

    // Workers: their assigned tasks are ready to run.
    for (const agent of team) {
      if (agent.isLead) continue;
      const st = this.hub.status(agent.id);
      if (!st) continue;
      const task = this.planner.currentTask(agent.id);
      if (workerShouldStart(agent, st, task)) void this.startAgent(agent.id);
    }

    // Runs that ended: PR → in-review; error → needs-input; clean → idle.
    for (const agent of team) {
      const st = this.hub.status(agent.id);
      if (!st || st.session.state !== "running") continue;
      const run = this.sessions.backend.getRun(this.hubName(agent.id));
      if (!run?.exited) continue;
      await this.runEnded(agent.id, run.exitStatus);
    }
  }

  private hubName(agentId: string) {
    return this.hub.name(agentId);
  }

  async runEnded(agentId: string, exitStatus: number | null) {
    const agent = this.hub.cfg(agentId);
    if (!agent) return;
    const task = this.planner.currentTask(agentId);
    const name = this.hub.name(agentId);
    const found = task ? await findPr(task.id) : null;
    if (found && task) {
      this.planner.updateTask(task.id, { status: "in-review", prNumber: found.number });
      this.hub.setStatus(agentId, { state: "in-review", note: `PR #${found.number}` });
      this.hub.activity("pr.opened", agentId, `${name} opened PR #${found.number} (${found.title})`);
    } else if (exitStatus !== 0) {
      this.hub.setStatus(agentId, { state: "needs-input", note: `Run ended with exit code ${exitStatus}. See the terminal.` });
      this.hub.activity("agent.needs-input", agentId, `${name}'s run ended with exit code ${exitStatus}`);
    } else {
      this.hub.setStatus(agentId, { state: "idle", note: "Finished — no PR opened. See the terminal." });
      this.hub.activity("agent.answered", agentId, `${name} finished without opening a PR`);
    }
    this.hub.setSession(agentId, { state: "stopped", detail: null });
  }

  /** Starts an agent's one-shot run. `force` restarts without waiting for the dispatch rules. */
  async startAgent(agentId: string, opts: { force?: boolean } = {}) {
    const agent = this.hub.cfg(agentId);
    const st = this.hub.status(agentId);
    if (!agent || !st || st.session.state === "running" || st.session.state === "starting" || st.session.state === "failed") return;
    const queued = this.inbox.take(agentId);
    if (agent.isLead) {
      if (!opts.force) return;
      const prompt = leadPrompt(agent, this.hub.snap.config, this.hub.snap.tasks, queued);
      await this.sessions.start(agentId, prompt);
      this.hub.setStatus(agentId, { state: "working", note: "Planning…" });
      return;
    }
    const task = this.planner.currentTask(agentId);
    if (!task || task.ownerId !== agent.id || task.status !== "todo" || task.prNumber) {
      if (!opts.force) return;
      if (!task) return;
    }
    const prompt = workerPrompt(agent, this.hub.snap.config, task, queued);
    await this.sessions.start(agentId, prompt);
    this.planner.updateTask(task.id, { status: "in-progress" });
    this.hub.setStatus(agentId, { currentTaskId: task.id, state: "working", note: task.title });
  }
}
