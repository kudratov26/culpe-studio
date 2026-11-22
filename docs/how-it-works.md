# How jsm-hq-opencode works

What HQ does behind the office: where agents work, how the lead plans, what reaches GitHub, and what HQ saves. New here? Start with the [getting-started guide](getting-started.md).

- [The team](#the-team)
- [Workspaces and runs](#workspaces-and-runs)
- [The lead and dispatching](#the-lead-and-dispatching)
- [Messages between agents](#messages-between-agents)
- [GitHub and reviews](#github-and-reviews)
- [Sandboxes and network access](#sandboxes-and-network-access)
- [Terminals, links and ports](#terminals-links-and-ports)
- [Action items](#action-items)
- [Settings you can change any time](#settings-you-can-change-any-time)
- [What HQ saves, and where](#what-hq-saves-and-where)
- [Windows](#windows)
- [Keyboard shortcuts](#keyboard-shortcuts)

## The team

- **The lead** plans and assigns. It creates boards (for example one per phase), splits the work into tasks and gives each task to a free worker. It never writes app code.
- **Workers** build. One task means one branch and one pull request. A worker edits only the files its task lists and asks the lead if it needs more.
- Each agent runs **OpenCode**, in a **Sandbox** (the default) or in **Local** mode. Set this per agent in Settings → Team.

New teams get names from The Office: Michael leads, then Dwight, Jim, Pam and so on. Rename them any time.

## Workspaces and runs

- **Its own copy of the repo.** Each agent gets a full clone at `~/.jsmhq/<project>/<agent>/`. Your own working folder is never touched.
- **Its instructions.** HQ writes `opencode.jsonc` into that folder: the Team MCP server (`hq`) at `http://host.docker.internal:<hqPort>/mcp` (or `127.0.0.1:<hqPort>` in Local mode) with this agent's token, so its tools work. The folder's own `AGENTS.md`/`ROLE.md` is included in the agent's role, never overwritten.
- **Its run.** With one-shot OpenCode runs, each agent's run is `opencode run --auto <prompt>` (the lead's or the task's prompt). The process's output goes to `<agent-folder>/hq-agent.log`, which is excluded from the agent's git — the office's **Terminal** views are tails of that file. On macOS and Linux, agents run in the workspace's sandbox; in Local mode they run on your machine in the folder.

There is no tmux and nothing to type into an agent's terminal: an agent's run is one-shot, and its drawer's terminal shows what it did.

## The lead and dispatching

- **The lead runs when there is new work.** When tasks exist that nobody owns, the lead's run starts with a prompt: review `list_workers`, and `assign_task` each task to a free worker. It exits when there is nothing actionable.
- **Workers run when their task is assigned.** The Dispatcher polls: a worker starts when its task is assigned (status `todo`) and it is idle with no run going. Its prompt carries the task's id, title, description, files, done-when and any messages queued for it.
- **Run endings** are noticed by the Dispatcher (it polls every 2s): a run that opened a PR → the task moves to **in-review**; a run that ended with an error → the agent shows **needs-input**; a clean end without a PR → the agent is **idle** ("Finished — no PR opened").

## Messages between agents

Agents talk to each other and to HQ through the Team MCP server called `hq` (the one their `opencode.jsonc` points at).

- The lead uses it to create boards and tasks and to assign them. Any agent can send a message.
- With one-shot runs, messages queue in HQ; the Dispatcher appends them to an agent's next prompt. An agent can also reply with `send_message` while it runs.
- You can message any agent from its drawer in HQ.

## GitHub and reviews

HQ reads your PRs, checks and review comments with your `gh` login, about every 20–30 seconds.

- It matches a PR to its task by the `[TASK-ID]` at the start of the title (or in the branch name — workers use `hq-<TASK-ID>`).
- New review comments are sent to the PR's author to fix.
- When a PR passes review, the lead is told it's ready to merge.
- When a PR is merged, its task is marked done.
- If a PR has merge conflicts with `main`, the author is told to fix them.

**HQ never merges.** You merge on GitHub. Pick the review tool in Settings → Workflow: CodeRabbit, Greptile, Copilot, you, or your own.

Without a `gh` login (`gh auth login`), the office still shows agents and their logs, but PRs are never noticed — workers see the `gh pr create` step fail inside their terminal.

## Sandboxes and network access

Each agent in Sandbox mode runs in its own [Docker Sandbox](https://docs.docker.com/ai/sandboxes/), a small VM with its own copy of the repo. It can't reach the rest of your machine.

- **Network policy.** You choose one when you install Docker Sandboxes. **Balanced** is recommended: AI services, package registries and GitHub are allowed, everything else is blocked. HQ never changes it; it only adds the one rule that lets sandboxes reach HQ.
- **When an agent needs a website** (a tool's docs or an API), it asks with the `request_access` tool instead of working around the block. Its card turns red and its drawer shows **Allow for this agent / Allow for everyone / Deny**.
- **Blocked requests** the agent didn't ask about are listed too: the agent's card shows "N blocked", and its drawer lists them with **Allow / Dismiss**.
- **Allowing a website** adds a rule for that sandbox only. Your base policy is never touched, and HQ only removes rules it added.
- **CPU and memory** are set in Settings → Sandbox. A sandbox gets its size when it's created, so after changing it press **Recreate sandbox**. Stop and Start keeps the old size. Recreating keeps the agent's folder and code but clears anything installed inside the sandbox.

## Terminals, links and ports

- **Resize any panel.** Drag a panel's left edge to make it wider (HQ remembers the width in this browser; double-click the edge to reset), or press the square button to fill the screen.
- **Shell tab.** A shell inside the agent's sandbox (or its folder in Local mode), beside the agent. In Sandbox mode: `sbx exec -it <name> sh` — the "Running" checks' commands use it too.
- **Terminal** (top bar). Your own shell on this machine, not in a sandbox: in your repo, an agent's folder, or any folder you type. Be careful in an agent's folder while it's working: it's the same copy of the repo the agent is editing.
- **Ports.** When a program in the Shell tab prints a `localhost:<port>` address, HQ offers to **Forward port**: then `localhost:<port>` on your machine reaches the sandbox. CLI sign-ins that redirect your browser back to `localhost` need this. The program inside the sandbox must listen on all addresses (`0.0.0.0`), not only `127.0.0.1`.

## Action items

**Action items** in the top bar is everything waiting on you:

- requests from agents (made with the `ask_user` tool): create a database, add a key, change a dashboard setting. Each one has exact steps and names the variable, never the secret value;
- websites agents asked to reach, and ones their sandbox blocked;
- pull requests ready to merge.

Mark a request **Done** (with an optional note) or **Dismiss** it, and HQ tells the agent so it can continue. Action items stay on your machine and are never committed.

## Settings you can change any time

| Setting | Where | Applies |
| --- | --- | --- |
| Office name (the sign on the wall) | Settings → Project | Right away, for everyone on the project |
| Review tool | Settings → Workflow | Right away |
| Agents, roles, mode | Settings → Team | Next time the agent starts |
| CPU and memory | Settings → Sandbox | After **Recreate sandbox** |
| MCP servers per agent | Settings → MCP | Right away for new servers |

## What HQ saves, and where

| File | What | Commit it? |
| --- | --- | --- |
| `.jsmhq/config.json` (in your repo) | Team, workflow, office name | Yes, so your team shares it |
| `.jsmhq/plan.json` (in your repo) | Boards and tasks | Yes |
| `docs/plan.md` (in your repo) | A readable copy of the plan, if **Settings → Project → Export plan** is on | Yes |
| `~/.jsmhq/<project>/` | Agents' folders, app variables, action items and HQ's own records | No, it's outside your repo, on your machine only |

**Remove a project:** delete each agent in Settings → Team (this removes its sandbox and, if you choose, its folder), then delete `~/.jsmhq/<project>`.

## Windows

Windows 11 support is experimental. Run HQ in PowerShell or Windows Terminal, not in WSL.

- There's no tmux, so agents run one-shot in their folders/sandboxes.
- Use the terminal in the agent's drawer; there's no `tmux attach`.
- In Local mode, a sandboxed agent's clone uses LF line endings, whatever your git's `core.autocrlf` says, because the sandbox runs Linux.

## Keyboard shortcuts

| Key | Does |
| --- | --- |
| `1`–`9` | Open that agent |
| `Esc` | Close panels |
| `+` / `-` | Zoom in / out |
| `D` | Toggle the debug panel |

Drag to move around the office; scroll to zoom.
