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

By default the worker runs in dry-run mode so initial build, heartbeat, and feedback jobs can be tested without invoking Codex. To execute Codex with persistent project manager sessions:

```bash
STARTUP_OS_DRY_RUN=false npm run dev:worker
```

If you need to replace the manager-session behavior with a custom command, set `CODEX_COMMAND_TEMPLATE`. Supported template tokens:

- `{prompt}`: shell-quoted prompt text
- `{promptFile}`: shell-quoted path to a prompt file
- `{projectPath}`: shell-quoted project path

The command runs with the project folder as the working directory.

If `STARTUP_OS_DRY_RUN=false` and `CODEX_COMMAND_TEMPLATE` is not set, the worker uses persistent Codex manager sessions by default:

- first run: `codex exec --json`
- later runs: `codex exec resume <session-id> --json`

The session ID is saved in `PROJECT.md > Codex manager thread`, so you can resume the same manager chat manually:

```bash
cd projects/<slug>
codex resume --include-non-interactive <session-id>
```

Useful worker options:

- `STARTUP_OS_CODEX_SANDBOX=workspace-write` controls the Codex exec sandbox.
- `STARTUP_OS_CODEX_APPROVAL_POLICY=never` controls the non-interactive approval policy.
- `STARTUP_OS_CODEX_MODEL=<model>` pins the model for worker turns.
- `STARTUP_OS_CODEX_BYPASS_SANDBOX=true` uses Codex's full-access bypass flag. Use this only in a controlled local environment.
- `CODEX_COMMAND_TEMPLATE='...'` replaces the persistent manager behavior with a custom command.

## Start Building A Project

After creating a project, open its project detail page and check `PROJECT.md > Build phase` plus `QUEUE.md > Now`.

New projects start in `initial-build`. In this phase the agent should create the first demonstrable local prototype, mock or defer external dependencies, and update `PROJECT.md` with the current state and any local run/view instructions. After the first demo exists, move the project to `working`; heartbeats are then normal iteration cycles.

Each project gets one persistent Codex manager thread once real worker execution starts. The worker sends initial build, heartbeat, and feedback jobs as new turns in that same session. The manager can spawn subagents during a turn for bounded exploration, implementation, testing, or review, then report a consolidated update back into the main thread.

To ask the system to build:

1. Start the dashboard with `npm run dev:dashboard`.
2. Start the worker in another terminal.
3. Open the project detail page.
4. Click `Start initial build`.
5. Watch `Jobs` for queued/running state.
6. Watch `Runs` for logs, summaries, errors, and completion state.
7. When the first demo works, mark the project `Working`.
8. Use `Heartbeat` or feedback for follow-up work.

By default the worker is a dry run. It proves that jobs are queued, claimed, logged, and completed without invoking Codex. To let it actually run Codex inside the project folder with persistent manager sessions:

```bash
STARTUP_OS_DRY_RUN=false npm run dev:worker
```

## Heartbeats

A heartbeat is one autonomous work cycle for a project in the working phase. The prompt tells the worker/Codex to read:

- `AGENTS.md`
- `PROJECT.md`
- `QUEUE.md`
- `LOG.md`

It should then work on the current `QUEUE.md > Now` item, or choose another useful MVP task, make scoped local progress, run practical checks, and update `QUEUE.md` and `LOG.md`.

Heartbeats are explicit in v1. Clicking `Heartbeat` queues a job. The worker must be online to execute it. When a Codex manager thread already exists, the heartbeat resumes that thread instead of starting a fresh chat.

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

Initial build, heartbeat, and feedback actions create persisted jobs and runs in SQLite. If the worker is offline, jobs remain queued. When the worker comes back, it claims queued jobs, resumes the project manager thread when available, and records streamed Codex JSON events, logs, summaries, errors, and status.

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
