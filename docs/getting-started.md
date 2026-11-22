# Getting started with jsm-hq-opencode

This guide takes you from a fresh machine to a team of OpenCode agents working on your repo. It takes about 15 minutes, most of it installing tools. You only do it once.

**You'll need:**

- A Mac (Apple silicon, macOS 14+), Linux (Ubuntu 24.04+), or a Windows 11 PC.
- [OpenCode](https://opencode.ai) — the agent backend every worker runs. `opencode --version` should answer.
- A [Docker](https://app.docker.com/signup) account (free) for Docker Sandboxes (optional — you can run agents in Local mode instead).
- A [GitHub](https://github.com/signup) account and a repo for your project.
- A GitHub account with `gh auth login` if you want agents to push branches and open pull requests (PRs and reviews are a core part of the office).

HQ checks everything below when it starts and shows a **setup checklist** with the exact command for anything missing, so you can also skip ahead and follow the checklist.

## 1. Install Node.js, git and the GitHub CLI

| | macOS | Linux (Ubuntu) | Windows 11 (PowerShell) |
|---|---|---|---|
| Node.js 20+ | `brew install node` | [nodesource](https://github.com/nodesource/distributions) or `nvm install 22` | `winget install OpenJS.NodeJS.LTS` |
| git | `xcode-select --install` | `sudo apt install git` | `winget install Git.Git` |
| GitHub CLI | `brew install gh` | `sudo apt install gh` | `winget install GitHub.cli` |

No Homebrew on your Mac? Install it from [brew.sh](https://brew.sh) first.

On Windows, close and reopen the terminal after installing so the new commands are found.

Then sign in to GitHub:

```bash
gh auth login
```

## 2. Install OpenCode

```bash
npm install -g opencode-ai
```

(`npx opencode` works too; the package is published as `opencode-ai`.) Check:

```bash
opencode --version
```

HQ uses OpenCode to run the lead and every worker — one `opencode run --auto <prompt>` per task.

## 3. Sign in to GitHub (for agents' PRs and reviews)

Agents push branches and open pull requests from inside their sandbox. Store your GitHub token in Docker's secret store; the sandbox proxy adds it to GitHub requests, so the token itself never enters the VM:

```bash
sbx secret set github --command "gh auth token"
```

(Run this after step 4, if you use sandboxes.) Without it, agents can't push or open PRs; everything else works.

## 4. Install Docker Sandboxes (optional)

Every agent runs in its own Docker Sandbox: a small VM with its own copy of your repo. Agents can't touch the rest of your machine.

| macOS | Linux (Ubuntu 24.04+, needs KVM) | Windows 11 |
|---|---|---|
| `brew trust docker/tap && brew install docker/tap/sbx` | `curl -fsSL https://get.docker.com \| sudo SBX=1 sh` | `winget install Docker.sbx` |

**Windows only:** turn on **Windows Hypervisor Platform** (Start → "Turn Windows features on or off"), then restart.

Check it worked:

```bash
sbx version
```

If you skip this, set agents to **Local** in Settings → Team when you create the team: OpenCode runs directly on your machine in each agent's folder.

### Sandbox network policy

A fresh sbx needs a base policy before any sandbox can start:

```bash
sbx policy init balanced
```

| Policy | Sandboxes can reach |
|---|---|
| **balanced** (recommended) | Typical development traffic: AI services, package registries, GitHub. Everything else is blocked unless you allow it. |
| allow-all | Anything on the internet. |
| deny-all | Nothing, unless you allow it domain by domain. |

You can allow extra domains for one agent later in **Settings → Sandbox**. HQ never changes this policy; it only adds one rule so sandboxes can reach HQ itself.

## 5. Prepare a GitHub repo

HQ works on a git repo that has a GitHub remote called `origin`. Each agent clones it, works on its own branch, and opens pull requests there. HQ follows those PRs and their reviews.

**An existing project** that's already on GitHub: nothing to do. Just open a terminal in its folder.

**A new project:**

```bash
mkdir my-app && cd my-app
git init -b main
echo "# My app" > README.md
git add . && git commit -m "Initial commit"
gh repo create my-app --private --source . --push
```

Tip: add a short `plan.md` (stack, features, phases) and push it before starting. The lead agent reads it to plan the work.

## 6. Run HQ

From your project's folder:

```bash
npx jsm-hq-opencode@latest
```

`@latest` makes sure npx doesn't reuse an old version it cached. HQ opens your browser. If it doesn't, open the `http://127.0.0.1:7420/?token=…` link printed in the terminal.

- **Welcome:** name the project and pick a lead and workers (one OpenCode agent for each) and a review tool. This is saved to `.jsmhq/config.json` in your repo.
- **Setup checklist:** anything still missing shows here with a **Copy** button and, for safe commands, **Run in terminal**. Press **Check again** after fixing something.

Leave the terminal running while you work. In Sandbox mode, agents run in their sandboxes; in Local mode, their `opencode run` processes run on your machine.

## 7. Start the team

1. Press **Start team** in the top bar. The first start takes a minute or two while each sandbox is created.
2. Click the lead and tell them what to build, for example:
   > Read plan.md. Create a board for Phase 1, plan its tasks with the files each one touches, and assign them.
3. Watch the office: tasks appear on the plan wall, agents work at their desks, and PRs roll through the review gate.
4. Review and merge PRs on GitHub yourself. HQ never merges. When you merge, the task is marked done.

An agent with a red **Needs input** badge is waiting for you. Click them and see what it was doing in their terminal.

To give agents extra tools (Supabase, Stripe, your own…), use **Settings → MCP**.

## Something not working?

| Problem | Fix |
|---|---|
| Start fails with "network policy has not been initialized" | Step 4: `sbx policy init balanced`. |
| Start fails with a Docker sign-in error | Your sign-in expired: `sbx login`, then **Check again**. |
| Agents can't push or open PRs | `gh auth login` (step 3), and check the repo has a GitHub `origin` (step 5). |
| An agent's state never changes | The sandbox can't reach HQ. `sbx policy ls` should show `localhost:<port>` and `host.docker.internal:<port>` allowed; HQ adds them on start. |
| "Port 7420 is in use" | Another HQ is running. Stop it or use `--port 7421`. |
| Windows: `listen EACCES` | Windows reserved that port. Use `--port 8420`. |

More in the [README](../README.md#troubleshooting). To learn what HQ does behind the office, read [How it works](how-it-works.md).
