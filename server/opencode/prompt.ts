// The prompts that start OpenCode workers and the lead. With one-shot runs the
// task comes in the first message, so the prompt carries the role, the task
// details and the branch/PR conventions: the worker branches `hq-<taskId>` and
// titles its PR `[<taskId>] <title>` (the same ids HQ matches in opencodePr.ts).

import type { AgentConfig, HqConfig, Task } from "../../src/data/types";
import { opencodeRoleMd } from "../agentFiles";

export function workerBranch(taskId: string): string {
  return `hq-${taskId}`;
}

export function workerSteps(task: Task): string {
  const branch = workerBranch(task.id);
  return `
1. Get the latest main: \`git pull origin main\`.
2. Create or switch to the branch ${branch}: \`git checkout -b ${branch}\` (if it already exists: \`git checkout ${branch}\`).
3. Do the work for the task.
4. Commit on the branch: \`git add -A && git commit -m "<one-line summary>"\`.
5. Open the PR: \`git push -u origin ${branch}\` and then \`gh pr create --title "[${task.id}] ${task.title}" --body "Task ${task.id}: ${task.title}"\`.
   If \`gh\` or GitHub is not available from here, push the branch and say so in your final message.
6. Stop when the PR is open (or when the work is done).
`;
}

export function workerPrompt(agent: AgentConfig, cfg: HqConfig, task: Task, queued: string | null): string {
  const files = task.files?.length ? `Files you may edit (edit only these):\n${task.files.map((f) => `- ${f}`).join("\n")}\n` : "";
  const doneWhen = task.doneWhen ? `Done when: ${task.doneWhen}\n` : "";
  const description = task.description?.trim();
  const messages = queued ? `\n\nYou also got messages while running:\n${queued}` : "";
  return [
    opencodeRoleMd(agent, cfg),
    "",
    `## Assigned task ${task.id} — ${task.title}`,
    ...(description ? ["", description] : []),
    files ? ["", files] : [],
    doneWhen ? ["", doneWhen] : [],
    "",
    "## Steps",
    workerSteps(task),
    messages,
  ].filter(Boolean).join("\n");
}

export function leadPrompt(agent: AgentConfig, cfg: HqConfig, tasks: Task[], queued: string | null): string {
  const unassigned = tasks.filter((t) => t.status === "todo" && t.ownerId == null);
  const list = unassigned.length ? unassigned.map((t) => `- ${t.id} — ${t.title}${t.description ? ` — ${t.description.slice(0, 200)}` : ""}`).join("\n") : "_No unassigned tasks._";
  const messages = queued ? `\n\nYou also got messages while planning:\n${queued}` : "";
  return [
    opencodeRoleMd(agent, cfg),
    "",
    `## New work to plan`,
    list,
    "",
    "## Rules",
    "- Assign each task to a free worker with `assign_task` (one task, one worker, one branch, one PR).",
    "- Check `list_workers` first: only assign to agents that are running and not working on another task.",
    "- Keep tasks small; set the files a worker may edit and a clear done-when.",
    "- When there are no unassigned tasks and nothing actionable, exit without doing anything.",
    "- Never write app code.",
    messages,
  ].filter(Boolean).join("\n");
}
