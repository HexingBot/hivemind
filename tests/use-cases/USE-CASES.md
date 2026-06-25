# Use-Case Suite

**Project:** hivemind
**Generated:** 2026-06-11T00:00:00Z

## Primary Use Cases

This manifest designates the primary use cases for the hivemind.
Each use case is covered by one or more existing e2e spec files listed below.
Tickets must only modify this suite when a primary use case changes
(new, changed, or removed use case) — never one spec per ticket.
Suite size tracks product surface, not ticket count.

### Initialize a project (intake wizard)

- tests/e2e/init.spec.js
- tests/e2e/intake-e2e.spec.js

### Mint a ticket (new task)

- tests/e2e/new-task-cli.spec.js
- tests/e2e/new-task.spec.js

### Drive the workflow (task-store transitions)

- tests/e2e/task-store.spec.js

### Resume a session across machines (lifecycle)

- tests/e2e/lifecycle.spec.js
- tests/e2e/round-trip.spec.js

### Install as a plugin

- tests/e2e/e2e-install.spec.js
- tests/e2e/plugin-deps.spec.js
