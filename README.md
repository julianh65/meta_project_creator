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

## Start Building A Project

After creating a project, open its project detail page and check `QUEUE.md > Now`. That is the task the project agent will try first.

To ask the system to build:

1. Start the dashboard with `npm run dev:dashboard`.
2. Start the worker in another terminal.
3. Open the project detail page.
4. Click `Heartbeat`, or add feedback in the feedback box.
5. Watch `Jobs` for queued/running state.
6. Watch `Runs` for logs, summaries, errors, and completion state.

By default the worker is a dry run. It proves that jobs are queued, claimed, logged, and completed without invoking Codex. To let it actually run Codex inside the project folder:

```bash
STARTUP_OS_DRY_RUN=false CODEX_COMMAND_TEMPLATE='codex {prompt}' npm run dev:worker
```

## Heartbeats

A heartbeat is one autonomous work cycle for a project. The prompt tells the worker/Codex to read:

- `AGENTS.md`
- `PROJECT.md`
- `QUEUE.md`
- `LOG.md`

It should then work on the current `QUEUE.md > Now` item, or choose another useful MVP task, make scoped local progress, run practical checks, and update `QUEUE.md` and `LOG.md`.

Heartbeats are explicit in v1. Clicking `Heartbeat` queues a job. The worker must be online to execute it.

## Progress Updates

When the worker claims a job, it writes the current project task and the planned work loop into the run log. While a real command is running, the worker appends periodic `Still running...` updates and keeps the job heartbeat fresh so the dashboard can show that work is live.

The heartbeat prompt also asks Codex to print a short starting plan and brief progress updates as it completes meaningful steps. The quality of those updates depends on the configured command/agent, but the worker-level live status does not.

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

## Inbox And Browser/Ops

The inbox is for things that actually need attention: decisions, blockers, approvals, secrets, login/CAPTCHA/2FA/payment handoffs, account setup, deploy approval, and other explicit external side effects.

Queue sections are synced into inbox items, but the sync intentionally ignores generic placeholders like `None yet` and broad review reminders. The system should err toward doing local work and only surfacing concrete requests.

Responding from the inbox records your answer, archives the item, appends context to the project files, and queues a feedback run so the worker can act on it. Approving, rejecting, or marking an item done archives it from the active inbox.

## In-App Docs

The dashboard has a `How It Works` page. Update that page as features are added or behavior changes, so the app always explains the current operating model.

## Useful Scripts

```bash
npm run dev:dashboard
npm run dev:worker
npm run test
npm run test:e2e
npm run typecheck
npm run build
```
