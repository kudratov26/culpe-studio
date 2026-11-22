// Finds the PR a worker opened for its task — office parity with JSM-HQ, where
// workers open PRs themselves and HQ notices them by matching the task id
// (the title's `[ID] …` or the branch name).

import { parseCliJson } from "./lib/json";
import { run } from "./lib/exec";
import { log } from "./lib/log";

export interface PrMatch {
  number: number;
  title: string;
  url: string;
  headRefName: string;
}

/** Does this PR belong to the task? Title `[ID] …` or a branch containing the id. */
export function matches(pr: { title: string; headRefName: string }, taskId: string): boolean {
  const id = taskId.toUpperCase();
  return pr.title.toUpperCase().startsWith(`[${id}]`) || pr.headRefName.toUpperCase().includes(id);
}

/** The task's open PR, or null when there isn't one (or `gh` can't tell). */
export async function findPr(taskId: string): Promise<PrMatch | null> {
  const r = await run("gh", ["pr", "list", "--state", "open", "--limit", "20", "--json", "number,title,url,headRefName"], { timeoutMs: 15_000 });
  if (!r.ok) {
    const msg = (r.stderr || r.stdout).trim().split("\n")[0];
    if (msg && !/not logged in|not signed in|unauthoriz/i.test(msg)) log.warn(`gh pr list: ${msg}`);
    return null;
  }
  const prs = parseCliJson<PrMatch[]>(r.stdout) ?? [];
  return prs.find((p) => matches(p, taskId)) ?? null;
}
