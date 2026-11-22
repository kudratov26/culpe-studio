# Glossary

The domain model of **jsm-hq-opencode**: an office of agents that plan and build work on a git repo. Terms as the system uses them, so the office, the docs and the code agree.

## Core

- **Project** — a git repo managed by HQ. Identified by `project.id` (`slugify(repo name)`); saved to `.jsmhq/config.json`.
- **Board** — a column on the office wall: `{ id ("P1"), title, status: "active" | "planned" | "done", order }`.
- **Task** — one piece of work: `{ id ("P1-T02"), boardId, title, ownerId, status, needs, prNumber, description, files, doneWhen, note }`.
- **Agent** — a team member: `{ id ("dwight"), name, role, isLead, cli ("opencode"), mode, color }`.
- **Lead** — the agent with `isLead`. It plans: creates boards and tasks, assigns them. It never writes app code.
- **Worker** — a non-lead agent. It builds the tasks assigned to it, one task per branch and one per PR.

## OpenCode specifics

- **Run** — one `opencode run --auto <prompt>` process. Agents are one-shot: the office "works" while a run is going.
- **Prompt** — the message the agent runs with: the role + the task details (id, title, description, files, done-when) + rules (branch `hq-<taskId>`, PR `[<taskId>] …` via `gh pr create`) + any queued messages.
- **hq-agent.log** — where a worker's output goes (`<agent-folder>/hq-agent.log`); the office Terminal views are tails of it.
- **Dispatcher** — the poller that starts the lead's wave and workers' runs, and notices run endings (PR → `in-review`).

## Workflow

- **Task branch** — workers create/switch to `hq-<taskId>`.
- **PR** — opened by the worker with `gh pr create --title "[<taskId>] …"`. HQ matches PRs to tasks by the `[TASK-ID]` prefix or the branch name (`hq.ts`: `taskIdOf`/`matches`).
- **Sandbox** — Docker Sandbox of an agent (Sandbox mode): its own VM with a clone of the repo.
- **Inbox** — messages queued to an agent (`planner.message`, HQ notices). The Dispatcher appends them to an agent's next prompt (`Inbox.take`).
- **Action item** — something you must do outside the system (`ask_user`), persisted in `~/.jsmhq/<project>/action-items.json`.

## Rules of thumb

- **One task = one branch = one PR.**
- Workers pull `origin main` first; the PR is the handoff.
- **HQ never merges.** You merge on GitHub; HQ marks the task done when the merge lands (review polling).
- Anything HQ can't verify goes to you via action items, not invented.
