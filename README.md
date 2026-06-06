# Startup OS

Startup OS is a local-first project swarm dashboard. It lets you turn a messy idea prompt into a normal project folder, keep durable Markdown memory in that folder, and queue Codex/agent work through a local worker.

The source of truth for each project is the folder under `projects/<slug>/`, especially:

- `AGENTS.md`
- `PROJECT.md`
- `QUEUE.md`
- `LOG.md`

The dashboard indexes those files into SQLite for fast display, but if files and database disagree, the files win.

## Install

```bash
npm install
```

## Run The Dashboard

```bash
npm run dev:dashboard
```

Open `http://localhost:4400`. The API runs on `http://localhost:4401` and stores local state in `data/app.db`.

## Run The Worker

In another terminal:

```bash
npm run dev:worker
```

The worker heartbeats into SQLite so the dashboard can show online/offline state. Jobs stay queued while the worker is offline.

By default the worker runs in dry-run mode so heartbeat and feedback jobs can be tested without depending on a particular Codex CLI syntax. To execute Codex, set a command template:

```bash
STARTUP_OS_DRY_RUN=false CODEX_COMMAND_TEMPLATE='codex {prompt}' npm run dev:worker
```

Supported template tokens:

- `{prompt}`: shell-quoted prompt text
- `{promptFile}`: shell-quoted path to a prompt file
- `{projectPath}`: shell-quoted project path

The command runs with the project folder as the working directory.

## Create A Project

1. Open the dashboard.
2. Go to `New Project`.
3. Paste a long messy prompt.
4. Generate a proposal.
5. Edit the proposal and Markdown file previews.
6. Create the project.

The project will be created under `projects/<slug>/`. Optional scaffolding can add a small starter codebase based on project type.

## Work Manually With Codex

Every generated project is a normal folder. To take over manually:

```bash
cd projects/<slug>
codex
```

The generated `AGENTS.md`, `PROJECT.md`, `QUEUE.md`, and `LOG.md` give Codex the local context it needs.

## Jobs And Offline Behavior

Heartbeat and feedback actions create persisted jobs and runs in SQLite. If the worker is offline, jobs remain queued. When the worker comes back, it claims queued jobs and records logs, summaries, errors, and status.

Running jobs that appear abandoned are marked interrupted by the worker on startup after a stale threshold. This is intentionally simple because the worker is expected to run locally on a MacBook and may disappear when the laptop sleeps.

## Useful Scripts

```bash
npm run dev:dashboard
npm run dev:worker
npm run test
npm run test:e2e
npm run typecheck
npm run build
```
