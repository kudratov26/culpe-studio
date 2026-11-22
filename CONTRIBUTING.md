# Contributing to jsm-hq-opencode

## Run it from source

Needs Node.js 20+, pnpm 11, git.

```bash
git clone <this repo> && cd jsm-hq-opencode
pnpm install
pnpm dev                                            # the UI with fake data, no agents
HQ_REPO=~/developer/hq-test pnpm dev:hq              # the real server + UI, with hot reload
```

`pnpm dev` is a demo with fake data: nothing runs and nothing leaves the browser. To test a change for real, use `pnpm dev:hq` or `pnpm hq` against a throwaway repo.

| Command | Does |
| --- | --- |
| `pnpm dev` | Demo UI with fake data at http://localhost:5173 |
| `pnpm dev:hq` | Real server + UI with hot reload (`HQ_REPO=<path>`) |
| `pnpm hq` | Builds the UI, then runs HQ like a release (`--repo <path> --port 7420`) |
| `pnpm build` | Type-checks, builds the UI to `dist/` and the server to `dist-server/` |
| `pnpm typecheck` | Type-check only |
| `pnpm test` | Unit tests (`tests/`) with node:test |
| `npm pack` | Builds the npm tarball, to test it before publishing |

## Where things are

```
src/
  data/       Types, the OfficeDataSource interface, fake (data/mock) and real (data/ws) data
  store/      Zustand stores; the only code that talks to the data source
  office/     The PixiJS pixel office: layout, sprites, agents, belt
  ui/         Top bar, team panel, activity, drawers, settings, setup checklist, welcome
server/
  main.ts, hub.ts, store.ts, repo.ts, workspace.ts   The server core
  sessions.ts     One-shot OpenCode worker sessions (backends/opencode.ts)
  backends/       The worker backend: OpenCode one-shot runs
  dispatch.ts     The dispatcher: lead planning and worker dispatch
  opencode/       Worker and lead prompts (opencode/prompt.ts), sandbox spec (opencode/spec.ts)
  opencodePr.ts   Matching workers' PRs to tasks
  planner.ts, planner helpers   Boards, tasks, assignments, messages
  inbox.ts, actionItems.ts      Delivery to agents; user action items
  mcp.ts, http.ts, github.ts, githubSync.ts, sbx.ts   The Team MCP, HTTP, GitHub sync, sbx
  setup.ts, access.ts, planExport.ts, skills.ts      Setup checklist, access requests, plan export
bin/            The jsm-hq-opencode command
docs/           User guides
tests/          Unit tests (node:test)
GLOSSARY.md     The domain model of this system
```

## Tests

```bash
pnpm test
```

## Releasing

1. Bump `version` in `package.json`.
2. Build (`pnpm build`) and publish (`npm publish`).
