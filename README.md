# jsm-hq-opencode

**Run a team of OpenCode agents on your repo, and watch them work in a pixel-art office — a JSM-HQ port to OpenCode.**

One **lead** agent plans the work and hands out tasks. Each **worker** gets its own desk, its own copy of your repo and its own Docker Sandbox, then opens a pull request. You see it all happen: the plan on the wall, agents at their desks, PRs moving through review.

Agents run **OpenCode**. Everything runs on your machine.

## Why use it

- **A real team, not one chat.** The lead splits the work into small tasks (one task, one branch, one PR) and assigns them. Agents message each other through HQ.
- **Safe by default.** Each agent works in its own Docker Sandbox, a small VM that can't touch the rest of your computer. Websites are blocked until you allow them.
- **You stay in charge.** Anything an agent needs from you (a decision, an API key, a blocked website) shows up in **Action items**. HQ never merges for you.
- **Your workflow.** Pull requests on GitHub, reviewed by CodeRabbit, Greptile, Copilot or you.

## Quick start

From inside a git repo that has a GitHub remote:

```bash
npx jsm-hq-opencode@latest
```

HQ opens in your browser and walks you through the rest:

1. **Welcome:** name the project, pick a lead and workers (one OpenCode agent for each).
2. **Setup checklist:** anything missing on your machine is listed with the command to fix it.
3. **Start team** in the top bar — the first start creates each agent's sandbox.
4. Tell the lead what to build, for example: *"Create a board for Phase 1, plan its tasks with the files each one touches, and assign them."*

**First time?** The [getting-started guide](docs/getting-started.md) takes you from a fresh machine to a working team, on Linux, macOS and Windows.

**Just trying it?** Use a throwaway repo:

```bash
mkdir hq-test && cd hq-test
git init -b main && echo "# HQ test" > README.md && git add . && git commit -m init
npx jsm-hq-opencode@latest
```

### Options

```
jsm-hq-opencode --repo <path>   the repo to manage (default: current folder)
                --port <n>      HQ port (default: 7420)
                --no-open       don't open the browser
                --version, --help
```

Use it often? `npm install -g jsm-hq-opencode`, then run `jsm-hq-opencode` in any repo.

## Requirements

| What | Why |
| --- | --- |
| Node.js 20+ | Runs HQ |
| git and a GitHub repo | Each agent clones it, pushes a branch and opens a PR |
| GitHub CLI (`gh`) | Reads PRs and reviews; `gh auth login` signs you in |
| OpenCode | The agent backend, `opencode --version` |
| Docker Sandboxes (`sbx`) | Each agent runs in its own VM (optional — Local mode runs OpenCode on your machine) |

Sandboxes need **macOS 14+ on Apple silicon, Windows 11, or Ubuntu 24.04+**. On other machines, set agents to **Local** in Settings → Team.

You don't need to install these by hand first. HQ checks for each one and shows the exact command. The [getting-started guide](docs/getting-started.md) has every step.

## How it works

1. **You tell the lead what to build.** It creates a board of small tasks, each with the files it may touch, and assigns them.
2. **Workers run OpenCode in their own sandboxes.** Each worker's run gets the task in its message; it pulls `main`, creates the branch `hq-<TASK-ID>`, writes the code and opens a PR titled `[TASK-ID] …`.
3. **HQ follows the PRs on GitHub.** Review comments go back to the author; a passing PR is reported to the lead; a merged PR marks the task done.
4. **Agents ask when they're stuck.** A question, a blocked website or a missing key shows up in **Action items** and on the agent's card.
5. **You review and merge.**

An agent with a red **Needs input** badge is waiting for you. Click them and see what it was doing in their terminal.

More detail on workspaces, sandboxes, MCP servers, what HQ saves, and OpenCode specifics: **[How it works](docs/how-it-works.md)**.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Start fails with "network policy has not been initialized" | `sbx policy init balanced`. |
| Agents can't push or open PRs | `gh auth login`, then **Check again** in the setup checklist. |
| Start fails with a Docker sign-in error | Your sign-in expired: `sbx login`, then **Check again**. |
| An agent's state never changes | The sandbox can't reach HQ. `sbx policy ls` should show `localhost:<port>` and `host.docker.internal:<port>` allowed; HQ adds them on start. |
| "Port 7420 is in use" | Another HQ is running. Stop it, or use `--port 7421`. |
| Windows: `listen EACCES` on start | Windows reserved that port. Use `--port 8420`. |

**Remove a project:** delete each agent in Settings → Team (this removes its sandbox and, if you choose, its folder), then delete `~/.jsmhq/<project>`.

## Docs

- [Getting started](docs/getting-started.md): install everything and run your first team.
- [How it works](docs/how-it-works.md): workspaces, sandboxes, GitHub, settings and files.
- [Contributing](CONTRIBUTING.md): run HQ from source.
- [Security](SECURITY.md): report a vulnerability privately.

## License

Code: [MIT](LICENSE). See [TRADEMARKS.md](TRADEMARKS.md).
