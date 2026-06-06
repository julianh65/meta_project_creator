You are building a local-first “project manager for my projects” system. The goal is to create a meta-project that helps me manage and advance many small startup/project ideas using Codex/LLM agents, while still keeping everything understandable, inspectable, and manually controllable.

This is not meant to become an overengineered operating system. Keep it simple and useful. The core idea is:

I have many different startup/product/project ideas. Some are serious, some are throwaway prototypes, some are websites, some are Expo/mobile apps, some are browser extensions, some are research/code tools. I want a central dashboard where I can add a new idea by writing a long messy prompt, have the system distill it into a self-contained project folder, and then let Codex/LLM agents push those projects forward over time. I also want to be able to get hands-on at any point by directly entering a project directory and running Codex myself.

The system should be designed around local project folders as the source of truth. The dashboard is a control plane and convenience layer, not the only place where state lives. Each project should be a normal folder/repo that I can `cd` into and work on manually.

The first version will run on my MacBook Pro. It will not always be online. It should tolerate that. Later I may move the worker/browser execution to an always-on Mac mini. For now, assume the dashboard and database may be running locally, or possibly the dashboard could later be hosted, but the actual execution worker runs on my MacBook and can go offline. Jobs should be persisted and recoverable. If the worker is offline, the UI should show that clearly and queue work for later.

## High-level product description

Build a local-first web dashboard + local worker for managing many semi-autonomous Codex-driven projects.

I want to be able to:

1. Create a new project from a long messy idea dump.
2. Have the system generate a project proposal and initial project files.
3. Have each project live in `projects/<slug>/`.
4. Have each project contain a small number of durable Markdown files:

   * `AGENTS.md`
   * `PROJECT.md`
   * `QUEUE.md`
   * `LOG.md`
5. Be able to manually run Codex from inside any project directory.
6. Also be able to trigger Codex runs from the dashboard.
7. See a clear dashboard of all projects, their state, their queue, recent activity, what needs me, what is stale, and what has recently run.
8. Have a global inbox of things that need my attention.
9. Have per-project pages where I can steer the project, add feedback, inspect files/state, trigger a heartbeat, and view recent runs.
10. Have a heartbeat concept, where each project can be periodically or manually prompted to review itself, make safe progress, update its files, and surface blockers.
11. Have a Browser/Ops request queue for external actions like account creation, posting, configuring services, CAPTCHA/login/2FA handoff, payments, DNS, social media, etc.
12. Keep project agents allowed to make local progress, browse/search/research if available, run and inspect their own local UI, draft marketing, and update project state.
13. Keep external side effects explicit and reviewable. Agents should not silently post publicly, email people, create paid services, bypass CAPTCHAs, or create accounts without me.
14. Support web projects and Expo/mobile projects well. For mobile/app projects, default to Expo/React Native/Expo Router and keep the core flow browser-previewable where possible. Avoid raw Xcode/native-code complexity until explicitly needed.
15. Keep the UI good, understandable, and useful. I should be able to glance at it and understand what each project is doing, what is blocked, what needs me, and what has changed.

The project should feel like a small, practical “personal project swarm dashboard,” not enterprise project management software.

## Important design philosophy

Do not overcomplicate the file protocol. Do not create dozens of Markdown files per project. The default per-project durable state should be:

```text
AGENTS.md
PROJECT.md
QUEUE.md
LOG.md
```

These files are important because I want each project to remain useful even outside the dashboard. If I open a terminal and run:

```bash
cd projects/paper-explainer && codex
```

Codex should have enough repo-local context to behave correctly.

The dashboard/database may index, parse, summarize, and display these files, but the files should remain the durable source of truth for the project’s context and intent.

The dashboard should be able to sync from files. If database and files disagree, prefer the files.

## Suggested repo structure for this meta-project

Use a sensible TypeScript stack. Prefer a monorepo-style layout if useful, but keep it simple.

A good target shape would be:

```text
startup-os/
  AGENTS.md
  README.md
  package.json
  apps/
    dashboard/
    worker/
  packages/
    shared/
    prompts/
  data/
    app.db
  projects/
    <project-slug>/
      AGENTS.md
      PROJECT.md
      QUEUE.md
      LOG.md
      ...
```

The `projects/` directory should be gitignored by the meta-project. Each child project may later become its own git repo.

For v1, SQLite is acceptable and probably best because this is local-first on my MacBook. Use a storage layer that could later move to Postgres without huge rewrites, but do not overbuild. If you think another local DB approach is better, choose it and document why.

Use a modern web UI stack. A good default is:

* Next.js or a Vite/React app for the dashboard
* TypeScript
* Tailwind/shadcn-style components if convenient
* SQLite for local persistence
* Node worker process
* Playwright for local browser preview/testing if feasible

Pick a stack that you can actually complete.

## Core app concepts

### Project

A project has:

* id
* slug
* name
* path
* type: `web`, `mobile-expo`, `browser-extension`, `cli`, `research`, `content`, or `unknown`
* autonomy: `throwaway`, `normal`, or `careful`
* status: `active`, `paused`, `stale`, `archived`
* one-liner
* created_at
* updated_at
* last_heartbeat_at
* last_worker_run_at

Most of this should be mirrored from or into `PROJECT.md`.

### Request / Inbox Item

Requests are things that need attention or represent external side effects.

Types should include:

* `needs_julian`
* `browser_ops`
* `marketing_approval`
* `deploy_approval`
* `secret_needed`
* `account_setup`
* `captcha_needed`
* `login_needed`
* `payment_needed`
* `code_review`
* `blocked`
* `general`

Statuses:

* `open`
* `queued`
* `running`
* `needs_julian`
* `approved`
* `rejected`
* `done`
* `failed`
* `stale`

Each request should have a project, title, body, status, type, risk level, timestamps, and a thread/log/comments area.

### Run

A run is a worker/Codex/heartbeat attempt.

Fields:

* project
* run type: `heartbeat`, `feedback`, `manual-job`, `onboarding`, `browser-check`, etc.
* status
* prompt/instruction used
* started_at
* finished_at
* logs
* summary
* files changed if detectable
* error if any

### Worker

The local worker runs on my MacBook. It should:

* heartbeat to the dashboard/database so the UI knows whether it is online
* pick up queued jobs
* run commands in project directories
* eventually invoke Codex CLI, but for v1 it may support a dry-run/manual mode if needed
* capture logs
* mark jobs interrupted/stale if the machine goes offline or the process dies
* not assume it is always on

Do not hardcode a fragile dependency on an exact Codex CLI syntax if uncertain. Make the Codex runner configurable. It should be easy to edit the command template.

For example, support a config like:

```text
codexCommandTemplate = "codex {prompt}"
```

or:

```text
codexCommandTemplate = "codex --ask-for-approval never {prompt}"
```

But document where I can change it. If Codex supports resume/session IDs, leave room for adding that later. The key is that jobs run in the correct project directory and the project-local Markdown files provide context.

## New project onboarding

This is one of the most important parts of the product.

I want to create a new project by writing a long messy prompt describing my intentions. The onboarding flow should accept that long prompt first, not force me into a rigid form.

The flow should be:

1. Big textarea: “Describe the project however you want.”
2. Optional fields:

   * name
   * project type
   * autonomy level
   * preferred stack
   * things to avoid
   * vibe/style notes
3. Generate a project proposal from that prompt.
4. Show the proposal to me before creation.
5. Let me edit key fields.
6. Generate preview contents for:

   * `AGENTS.md`
   * `PROJECT.md`
   * `QUEUE.md`
   * `LOG.md`
7. Let me edit those file previews.
8. Create the project folder under `projects/<slug>/`.
9. Optionally scaffold the codebase based on project type.
10. Optionally run the first heartbeat/Codex pass.

The onboarding system should preserve the original raw prompt somewhere in `PROJECT.md`, probably under `Original intent`, so the project agent can recover nuance later.

The onboarding should infer:

* what the project is
* target user
* MVP
* non-goals
* project type
* stack
* autonomy level
* first task
* what external dependencies may be needed now/later/deferred
* what needs Julian
* style/vibe notes

Example of generated `PROJECT.md` sections:

```md
# Project

## Name

## One-liner

## What this is

## Target user

## MVP

## Non-goals

## Project type

## Stack

## Autonomy level

throwaway | normal | careful

## Platform policy

For mobile-expo projects, use Expo and keep the core flow inspectable on web where possible. Avoid custom native code and Xcode unless explicitly approved.

## Current state

## Decisions

## Open questions

## External dependencies

### Needed now

### Needed soon

### Defer

## Original intent
```

Example `QUEUE.md`:

```md
# Queue

## Now

- [ ] First concrete task

## Later

- [ ] Future task

## Needs Julian

- [ ] Decision/request for me

## Browser/Ops Requests

- [ ] External/browser/account/action request

## Marketing Drafts

- [ ] Draft or content idea

## Done

- [x] Project created
```

Example `LOG.md`:

```md
# Log

## YYYY-MM-DD

- Project created from onboarding.
```

Example `AGENTS.md` should include:

* the agent is both project manager and builder
* the project may be worked by manual Codex or the meta worker
* the Markdown files are durable memory
* local progress is allowed
* external side effects require approval
* style guidance to avoid generic LLM/SaaS copy
* browser/search/local UI inspection guidance
* mobile/Expo guidance when relevant

## Per-project AGENTS.md behavior

For every created project, generate an `AGENTS.md` like this, adapted to the project:

```md
# Agent Instructions

You are the project manager and builder agent for this repo.

This project may be worked on in two ways:
1. Julian may run Codex manually from this directory.
2. The meta-project worker may run Codex automatically from this directory.

In both cases, treat this repo's Markdown files as durable memory.

Read these before doing meaningful work:
- PROJECT.md
- QUEUE.md
- LOG.md

After doing meaningful work, update:
- QUEUE.md
- LOG.md
- PROJECT.md only if the product/architecture/decision state changed

Bias toward visible progress. Prefer working prototypes over elaborate plans. Keep changes small enough to understand.

## Autonomy

Allowed without approval:
- inspect the repo
- edit local files
- run local commands
- install reasonable packages
- start local dev servers
- use browser/search tools if available
- inspect the local UI
- draft marketing copy/posts/comments
- create commits on non-main branches
- update PROJECT.md, QUEUE.md, and LOG.md

Requires Julian approval:
- production deploy
- paid services
- account creation
- public social posts/comments/replies
- external emails
- DNS/domain changes
- deleting meaningful work
- interacting with real users
- storing secrets
- changing auth/billing architecture

## Browser/Search

If browser or search tools are available, use them when useful:
- inspect the local UI
- debug frontend behavior
- research implementation details
- research competitors or marketing channels
- prepare external-operation requests

Do not bypass CAPTCHAs, anti-bot systems, paywalls, logins, or platform restrictions. If blocked by CAPTCHA, login, 2FA, payment, or account verification, write a clear item under `QUEUE.md > Needs Julian`.

## Style

Avoid generic AI startup copy.

Do not write phrases like:
- unlock
- supercharge
- seamlessly
- revolutionize
- dive into
- leverage
- transform the way you
- in today's fast-paced world
- whether you're

Prefer:
- concrete descriptions
- short examples
- plain language
- specific artifacts
- tasteful, slightly opinionated copy
- demo-first explanations

Before writing public copy, ask: could this sentence appear on 500 other AI startup landing pages? If yes, rewrite it.

## Work Loop

When asked to work autonomously:
1. Read PROJECT.md, QUEUE.md, and LOG.md.
2. Inspect the repo and current git status.
3. Pick the highest-leverage safe task.
4. Do the work.
5. Run relevant checks if practical.
6. Update QUEUE.md and LOG.md.
7. If blocked or a human decision is needed, write it under `Needs Julian`.
8. If external browser/account/social action is needed, write it under `Browser/Ops Requests`.
```

For mobile projects, add:

```md
## Mobile / Expo Policy

Prefer Expo, React Native, Expo Router, and TypeScript.

Development order:
1. Make the core flow work on web where possible.
2. Make it work in Expo Go if supported.
3. Use Expo development builds only when native functionality requires it.
4. Avoid raw Xcode/native modules unless Julian explicitly approves.

Keep a demo/debug route or screen that lets the agent inspect the core flow without needing a physical phone every time.
```

## Heartbeats

A heartbeat is a run that asks a project to review itself and make progress or surface blockers.

There should be a manual “Run heartbeat” button on each project page.

There should also be a way to configure heartbeat cadence per project, but keep it simple. Since the worker is on my MacBook and can go offline, the system should not pretend it can guarantee exact scheduling. It should track “last heartbeat” and “stale if no heartbeat for X days/hours.”

When the worker comes online, it can notice stale projects and optionally queue heartbeats, depending on settings.

Heartbeat prompt should be roughly:

```text
Read AGENTS.md, PROJECT.md, QUEUE.md, and LOG.md.

Run one autonomous work cycle.

If QUEUE.md has a Now item, work on it.
Otherwise choose a useful next task for the MVP.

You may edit code, run commands, inspect the local UI, use search/browser tools if available, and update project files.

Keep the change scoped and useful. Prefer something demonstrable.

If you need Julian or external side effects, write to QUEUE.md instead of blocking silently.

After work, update QUEUE.md and LOG.md. Summarize what changed.
```

## Dashboard UI

Make the UI good and understandable. Do not make it look like a raw admin panel if you can avoid it.

Important screens:

### Global dashboard

Should show:

* worker status: online/offline, last seen
* number of active projects
* projects needing me
* stale projects
* recent runs
* open Browser/Ops requests
* open marketing/deploy approvals

### Projects page

A grid or list of project cards.

Each card should show:

* name
* one-liner
* type
* autonomy
* status
* last heartbeat
* current Now task
* open Needs Julian count
* open Browser/Ops count
* recent run status
* quick actions: open, heartbeat, add feedback

### Global inbox

A clear inbox of items needing my attention.

Useful filters:

* Needs Julian
* Browser/Ops
* Marketing approval
* Deploy approval
* Blocked
* Failed runs
* Done/recent

Each inbox item should be readable and actionable.

### Project detail page

Should have:

* project overview
* current Now task
* Needs Julian
* Browser/Ops Requests
* Marketing Drafts
* recent log entries
* recent runs
* buttons:

  * Run heartbeat
  * Add feedback
  * Open project folder/path
  * Open local app URL if known
  * View/edit PROJECT.md
  * View/edit QUEUE.md
  * View/edit AGENTS.md
  * View/edit LOG.md

The project detail page should make it easy for me to steer the project.

Add a feedback box:

```text
Tell this project agent something...
```

Submitting feedback should create a queued run or append a clear item into `QUEUE.md` / request queue. I should be able to say things like:

```text
Make the landing page feel more like a research lab notebook, less like SaaS.
```

or:

```text
Stop working on auth. Make a fake local demo first.
```

### New project page

Implement the onboarding flow described above.

### Runs page

Show recent runs, logs, status, errors, summaries, and what files changed if possible.

### Browser/Ops page

For now this can be a queue of external/browser requests. You do not need to fully automate real account creation in v1, but design the UI around that future.

A Browser/Ops request should clearly show:

* project
* requested action
* why
* risk
* whether it needs login/CAPTCHA/2FA/payment
* status
* notes/thread

Eventually the Browser/Ops agent may use a visible browser with Playwright and pause for human takeover. For v1, build the request system and possibly a simple local browser preview capability.

## Browser/UI preview/testing

The coding agent building this project should use browser preview/testing sensibly.

As you implement the dashboard:

* run the app locally
* open it in a browser
* inspect how the UI looks
* fix obvious layout/UX issues
* verify core flows manually or with Playwright where reasonable

Please do not just write components blindly. The UI is important because I need to understand the state of lots of projects quickly.

Use sensible tests. Do not go overboard, but add enough confidence:

* unit tests for parsing/syncing project Markdown if practical
* tests for project creation/onboarding helpers
* tests for worker job state transitions if practical
* at least one basic end-to-end or integration-ish check if feasible
* make sure typecheck/lint/build pass

## Browser/Ops and external side effects policy

Do not build anything that tries to bypass CAPTCHAs, anti-bot systems, logins, or platform restrictions.

The intended behavior is:

* agents may request external actions
* Browser/Ops may help with them
* if CAPTCHA/login/2FA/payment/account verification occurs, the system pauses and asks me
* public posting, external emails, production deploys, paid services, account creation, DNS, and payment setup should require explicit approval

The system can draft posts/comments/copy, but posting/commenting publicly should be approval-gated.

## Mobile/Expo project support

When the user creates a mobile app project, especially something like my car agent idea, the meta-project should prefer:

* Expo
* React Native
* Expo Router
* TypeScript
* browser-previewable/debuggable core flow
* Expo Go first where possible
* Expo development builds only when necessary
* avoid raw Xcode unless explicitly approved

The generated project files for mobile projects should tell the project agent to keep a useful web/demo/debug path so the agent can inspect and improve the UI without always needing my phone.

## Worker/offline behavior

The worker will run on my MacBook Pro for now. It may go offline when I close the laptop.

Implement:

* worker last-seen heartbeat
* UI indicator for worker online/offline
* persistent job queue
* queued jobs stay queued when worker offline
* running jobs that stop unexpectedly become interrupted/stale/failed in a clear way
* when worker returns, it can continue processing queued jobs
* do not pretend exact cron scheduling is guaranteed

A project can be considered stale if it has not had a heartbeat or update in a configurable amount of time.

## Codex CLI integration

The whole system should be designed around Codex CLI or an equivalent coding-agent CLI being the execution substrate.

Do not assume too much about exact flags. Make the command configurable.

The worker should be able to run a job by:

1. Going into the project directory.
2. Preparing a prompt.
3. Running the configured Codex command/template.
4. Capturing output/logs.
5. Updating run status.

The point is that the same project works whether I run Codex manually or the dashboard/worker runs Codex automatically.

Manual usage must remain first-class. After a project is created, show a command like:

```bash
cd ~/startup-os/projects/<slug> && codex
```

## Root/meta project files

The meta-project itself should also have clear root instructions.

Create a root `AGENTS.md` explaining:

* this repo is the meta-project
* keep the system simple
* project folders are the source of truth
* do not add unnecessary files/process
* dashboard is a control plane
* local worker may go offline
* external side effects require approval

Create a `README.md` explaining:

* what the project is
* how to run dashboard
* how to run worker
* how to create a project
* how to manually enter a project and use Codex
* how job queue/offline behavior works
* where project folders live

## MVP acceptance criteria

By the end of this goal, I want a working v1 where I can:

1. Start the dashboard locally.
2. Start the worker locally.
3. See worker online/offline state.
4. Create a new project from a long messy prompt.
5. Review/edit the generated project proposal/files.
6. Create the project folder with `AGENTS.md`, `PROJECT.md`, `QUEUE.md`, and `LOG.md`.
7. See the project on the Projects page.
8. Open the project detail page.
9. View/edit the project Markdown files from the UI.
10. Add feedback to the project.
11. Run or queue a heartbeat job.
12. See the run status/logs.
13. See items from `Needs Julian` and `Browser/Ops Requests` surfaced in a global inbox.
14. Manually `cd` into the created project and have the local files be understandable enough for Codex to continue.
15. Have a UI that is good enough that I can understand project state quickly.

Do not overbuild beyond this. A clean, working, understandable v1 is better than a huge half-finished system.

## Implementation guidance

Work incrementally.

Suggested order:

1. Create the app structure and install dependencies.
2. Build the data model/storage layer.
3. Build Markdown file templates and project creation helpers.
4. Build project scanning/sync from `projects/`.
5. Build the dashboard shell and navigation.
6. Build Projects list and Project detail.
7. Build New Project onboarding flow.
8. Build Inbox.
9. Build worker heartbeat/online status.
10. Build job queue and simple run execution.
11. Add configurable Codex command integration.
12. Add logs/runs UI.
13. Add basic tests.
14. Run the app, inspect the UI in browser, and polish rough spots.
15. Update README/AGENTS.md.

Use good engineering judgment. Keep things typed, readable, and easy to modify.

When uncertain, choose the simpler implementation that preserves the core architecture:
project folders as source of truth, dashboard as control plane, local worker as executor, Codex as the agent substrate, and Markdown files as durable project memory.

make sure to commit. We don't need to actually make a project with it. Once we're in a good state I'm going to test with a small throaway project. Not needed now but just some random ideas I have that I'm going to use this for later. No need to index on this just to let you know.

Random ideas I want to use this for:
1. Better Learning Software built off Math Academy Way, Customized. All lessons and content and question is generated on the fly by LLMs and perfectly customized and atomized to the users knowledge.
2. Paper → Explainer Blog Post with Manim. Just a website where papers automatically get explained and diagrams and things are made with manim and it looks nice.
3. Auto Researcher. Point it at a repo and give it an objective and it spawns llms to try things out.
4. Voice Recording Social Media App. Kind of like twitter but voice recording first, casual you just do a voice recording and you can play through all etc etc.
5. Comment on all websites / pages. Basically a chrome extension or something that lets you comment on any page and you can see friends comments and there’s a global feed as well.
6. Car talking agent, podcast maker, ask questions, add to dos, all in one. Commute enhancer. Basically make the dead time during commutes better, listen to podcasts, create custom podcasts with notebooklm, interrupt it to add todos etc… notes pause, voice interaction etc…

Maybe at some point in the future I'll also want to monetize some if they're doing well, or de-onboard them from this and go more hands on if they start going well.
