# Hivemind

A multi-agent software development team that lives inside your repository. You
clone it, answer a short intake, and from then on you describe what you want
in plain language while specialized AI assistants research, write tests, ship
code, and review their own work.

This README is the five-minute onboarding for a non-technical operator. It
covers what you need installed, how to start a fresh project, what the wizard
produces, and what to say to Claude Code for your very first chat.

## What this is

Imagine hiring a small, disciplined engineering team that reads the ticket,
plans, writes tests first or validates behavior depending on the work (a tiered
policy keeps lighter tickets fast), implements until everything is green, reviews
each other's work, and only then closes the ticket. This repository is the
harness that makes Claude Code behave that way.

Two ideas drive the whole thing:

1. **A real ticket queue.** Every piece of work — a feature, a bug fix, a
   refactor — lives as a JSON ticket under `tasks/`. Nothing happens off the
   books.
2. **Specialized helpers.** The main chat (the orchestrator) does not write
   code itself. It dispatches the work to focused helpers — a researcher,
   a developer, a reviewer — and supervises their handoffs.

You drive all of this from a single Claude Code chat, in plain English.

## Two ways to get started

- **Install as a Claude Code plugin** (recommended, no cloning) — the steps
  right below.
- **Clone the repository** and run the wizard inside the clone — see
  *"First-time setup"* further down. Use this to work on the framework itself.

Either way you end up with the same thing: a project with a ticket queue, a
saved chat memory, and an orchestrator you talk to in plain English.

## Install as a Claude Code plugin

The quickest way in — you never clone anything. You only need **Claude Code**
and Node.js 20+ (see *Prerequisites*). Replace `<this-repo-url>` with this
repository's web address (e.g.
`https://github.com/HexingBot/hivemind.git`) or its folder on your machine.

```bash
# 1. Register the marketplace (once per machine)
claude plugin marketplace add <this-repo-url>

# 2. Install the team — orchestrator + helpers, available in every chat
claude plugin install hivemind@hivemind-marketplace

# 3. Confirm it registered (command, skills, agents, MCP server)
claude plugin details hivemind
```

Then go to the folder where you want to build something (an empty folder is
perfect), start Claude Code there, and run the bootstrap command in the chat:

```text
/hivemind:init-project
```

It asks a few questions — name, kind of project, who it is for, the main things
it should do, and the stack — then writes everything into *your* folder: a
`PROJECT.md` summary, a starter backlog under `tasks/`, the saved state under
`state/`, and a routing note for the orchestrator. No extra install step on your
side.

**Your first chat.** Tell the orchestrator what to do. For your very first
message, copy and paste this:

> Read `PROJECT.md` and the `tasks/` directory. Tell me which seeded ticket
> you would like to start with and why. Wait for my confirmation before
> opening it.

It proposes a ticket and — once you confirm — runs the full workflow: research,
tests or validation per the tiered policy, implementation, review, then closing
the ticket. Every later chat works the same way, or say "run the loop" to have
it work through several tickets unattended (see *Run the loop* below). To
update or remove the plugin later, use `claude plugin update`, `claude plugin
uninstall`, or `claude plugin marketplace remove hivemind-marketplace`.

## Prerequisites

You need three things on your machine:

- **Node.js 20 or newer** (`node --version`) — LTS installer at
  <https://nodejs.org>.
- **git** (`git --version`) — on Windows, Git for Windows from
  <https://git-scm.com>.
- **Claude Code**, the CLI that hosts the chat that drives this framework —
  install instructions at <https://docs.claude.com/claude-code>.

No global npm packages, no Docker, no databases — just plain JavaScript files
and a small JSON state directory.

## First-time setup

In a terminal, from the directory where you keep your projects:

```bash
git clone <this-repo-url> my-new-project
cd my-new-project
npm install
node bin/init.js
```

`npm install` pulls in the wizard's own dependencies (its JSON schema
validator); skip it and the very next command fails. `node bin/init.js` then
starts the intake wizard — project name, kind of project, who it is for, top
use cases, and the stack you want to build on. Two minutes, tops.

If you cloned this repository directly, the wizard notices its own historical
tickets under `tasks/` and offers to archive them so your project starts empty
(press Enter to accept). Two flags help in edge cases: `--force` re-runs the
intake from scratch, and `--no-archive` skips the history-archive question.

## What the wizard produces

Whether you ran `/hivemind:init-project` or `node bin/init.js`, the wizard
writes the same things into your project: a `PROJECT.md` summary (name, type,
use cases, target users, stack), a helper briefing under `.claude/agents/` you
never need to read yourself, and a small starter backlog under `tasks/` — a
handful of day-one tickets so you have something concrete to point Claude Code
at first.

You will also see a `state/` directory where the framework remembers what it was
doing between chats — leave it alone; it heals itself. Then start your first chat
exactly as in *Step 4* above (open Claude Code in the project folder and paste
the first-message prompt). Every later chat works the same way.

## Run the loop

For routine work, drive one ticket at a time as above. When you want the
orchestrator to work through several tickets toward a goal without repeating
instructions, tell it to run the loop:

```text
/hivemind:loop
```

Give it a **goal** — `label:<name>` (every ticket carrying that label) or
`keys:<TASK-001,TASK-002,...>` (an explicit list) — and confirm when asked. It
then repeats the normal per-ticket workflow unattended, pausing automatically
at five points: before any destructive or irreversible action (closing a
ticket, pushing, deleting a branch); at a human-observable UAT verdict; when
scope is genuinely ambiguous; before a release or version bump; and every few
completed tickets, so you can check in on what shipped. Say "run unattended" to
pre-authorize the routine pauses (close-on-green-review, orchestrator-verified
UAT, and the periodic check-ins) while pushes and version bumps stay opt-in.
Gate-by-gate detail lives in `commands/loop.md`.

## Day-two operations

A few things you will want to know as you go:

- **See open tickets**: open `tasks/` or ask the chat to list them.
- **File a new ticket**: `node bin/new-task.js` walks you through it, or pass
  flags (`--title`, `--description`, `--ac`, `--priority`).
- **Pause a session**: tell the chat "let's pause for the day" — it writes a
  handoff note so the next chat resumes cleanly.
- **Read the long-form rules**: `CLAUDE.md` at the repo root captures the
  team-wide operating principles.

## Preparing a distribution

If you maintain the framework and want to hand someone a clean, clone-ready copy
(not your working repo with its own tickets and session history), run:

```bash
node bin/make-template.js --yes
```

Without `--yes` it is a dry run that prints what it would change and touches
nothing. With `--yes` it clears the framework's own tickets and leftover
session state so the next person starts from a blank backlog, keeping the
reusable parts (helper definitions and the `knowledge/` library). Whoever
clones the result must run `npm install` before `node bin/init.js` — same
dependency as above.

The framework also ships a **kanban task board** — a browser tab showing all tickets in five status columns with drag-and-drop transitions and a new-ticket form. From Claude Code: `/hivemind:task-status`. Local-only (`127.0.0.1`).

## Getting help

If `node bin/init.js` fails or any chat goes off the rails, tell Claude Code
what you tried and paste the exact error message. The orchestrator is trained to
triage its own framework and usually points you at the problem in a turn or two.

Welcome aboard.
