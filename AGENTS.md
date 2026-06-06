# Agent Instructions

This repo is the meta-project: a local-first dashboard and worker for managing many separate project folders.

Keep the system simple and inspectable. Project folders under `projects/<slug>/` are the source of truth, and the dashboard is a control plane over those files plus a small local database.

Default durable project memory is limited to:

- `AGENTS.md`
- `PROJECT.md`
- `QUEUE.md`
- `LOG.md`

Do not add unnecessary process, hidden state, or extra protocol files unless there is a clear v1 need. The local worker may go offline when the laptop sleeps, so jobs must stay persisted and the UI must present worker status honestly.

External side effects require Julian approval. Do not silently create accounts, post publicly, send emails, configure DNS, pay for services, bypass CAPTCHAs, or store secrets.

When working in this repo:

1. Read `instructions.md` and this file for product intent.
2. Preserve manual use: Julian must be able to `cd projects/<slug> && codex`.
3. Prefer small typed modules over broad frameworks.
4. Keep the UI useful for quickly seeing what is blocked, stale, running, and waiting for Julian.
5. Run relevant checks before handing off.
