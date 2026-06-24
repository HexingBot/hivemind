---
description: Bootstrap the Hivemind in the current project — gather intake answers conversationally and materialize PROJECT.md, the project-context agent briefing, a seeded backlog, and a session bundle.
---

# /hivemind:init-project

You are bootstrapping the Hivemind into the user's
project. This command runs through the **Bash tool**, which has **no interactive
TTY** — so you (Claude) must gather the intake answers in conversation, write
them to a JSON file, and run the framework's bundled, self-contained init entry
in NON-INTERACTIVE mode. Never try to drive the framework's readline wizard; it
cannot read stdin from a Bash-tool invocation.

## Step 1 — Adaptive discovery dialogue

Lead with a short, focused conversation to understand what the user is building.
**Do not dump all questions at once.** One question at a time. Keep each prompt
to one line. No walls of text.

Start by asking about the problem: "What problem does this project solve?" Then
follow up on goals ("What does success look like?"), scope ("What's in, and
what's deliberately out of scope?"), and identity/stack. Probe gaps with a
focused follow-up before moving on — but if the answer is clear, keep moving.
Offer "I can infer X from what you said — does that sound right?" to accelerate.

Gather enough to populate all fields below with confidence. The discovery is
complete when you can write a crisp problem statement, a short goals list, a
scope-in list, and a scope-out list — plus the identity/stack fields.

Fields to collect across the dialogue (all become parts of the answers JSON):

**Definition fields (TASK-045 fields — become PROJECT.md body sections):**
- `problem_statement` — one-to-two sentence prose description of the problem being
  solved.
- `goals` — what success looks like; collect as a list.
- `scope_in` — what is explicitly in scope; collect as a list.
- `scope_out` — what is explicitly out of scope; collect as a list.

**Identity/stack fields (always required):**
- `project_name` — short, kebab-case preferred (e.g. `acme-billing`).
- `project_description` — one sentence describing the project.
- `project_type` — one of: `web-saas`, `cli-tool`, `library`, `other`.
- `target_users` — who the project is for.
- `primary_use_cases` — a JSON array of slugs (e.g. `["automation","reporting"]`).
  Prefer the known slugs: `data-entry`, `reporting`, `integration`, `automation`,
  `collaboration`, `other`. These drive the seeded backlog.
- `success_criteria` — how the user will know the project succeeded.

**Type-specific keys (include the set matching the chosen `project_type`):**
- `web-saas`: `frontend_framework`, `backend_framework`, `database`,
  `web_deployment_target`.
- `cli-tool`: `cli_language`, `distribution_channel`, `command_structure`.
- `library`: `library_language`, `audience`, `package_manager`.
- `other`: no extra keys required.

## Step 1b — Ask for CLAUDE.md routing consent (separate channel)

Separately from the intake answers, ask the user whether to add the
hivemind **orchestrator routing block** to their project's `CLAUDE.md`.
This block activates the RESUME-FIRST session contract so a fresh orchestrator
chat picks up where the previous one left off. It is MERGED into a fenced marker
block — the user's existing `CLAUDE.md` content is preserved byte-for-byte, and a
re-run only refreshes the block.

If the user agrees, pass `--claude-md-consent` on the init command in Step 3
(consent is its own flag; it is NOT inferred from the answers). If the user
declines, omit the flag and no block is written.

## Confirmation step — Play back the definition and get explicit approval

Before writing any file or running the init command, play back the understood
definition to the user in a compact summary:

> **Problem:** <one sentence>
> **Goals:** <bullet list>
> **Scope in:** <bullet list>
> **Scope out:** <bullet list>
> **Project:** `<name>` · `<type>` · target: `<users>`
> **Stack:** <relevant type-specific fields>
>
> Ready to initialize? (yes / no, or correct anything)

**You MUST receive explicit approval before proceeding to Step 2.** This
conversational playback is the only confirmation gate — answers-mode (Step 3)
skips the CLI's interactive confirm prompt (see Step 3 note), so there is exactly
one gate and it is here. Do not run the init command without a clear "yes."

## Step 2 — Write the answers to a temp JSON file

Map the collected answers into a **flat JSON object** of `{questionId: value}`.
Pass `goals`, `scope_in`, and `scope_out` as JSON arrays. Write the object to a
temporary file outside the plugin cache (a system temp dir is ideal).

Example (web-saas project with definition fields):

```json
{
  "project_name": "acme-billing",
  "project_description": "subscription billing for small SaaS teams",
  "project_type": "web-saas",
  "target_users": "finance teams at early-stage startups",
  "primary_use_cases": ["automation", "reporting"],
  "success_criteria": "first paying customer can self-serve an invoice",
  "problem_statement": "Small SaaS teams have no lightweight way to manage recurring invoices without expensive enterprise billing suites.",
  "goals": ["enable self-serve subscription management", "integrate with Stripe", "stay under $0 infrastructure cost at launch"],
  "scope_in": ["monthly/annual billing cycles", "Stripe as the sole payment processor", "email invoice delivery"],
  "scope_out": ["ACH/wire transfers", "multi-currency support", "in-app payment UI"],
  "frontend_framework": "react",
  "backend_framework": "node-express",
  "database": "postgres",
  "web_deployment_target": "fly-io"
}
```

## Step 3 — Run the bundled init entry against the user's project

Run the SHIPPED, self-contained bundle (NOT the raw source) via the Bash tool,
passing the answers file with `--answers-file`:

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/init.cjs --answers-file <path-to-the-tmp-json>
```

Append `--claude-md-consent` to that command when the user agreed in Step 1b:

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/init.cjs --answers-file <path-to-the-tmp-json> --claude-md-consent
```

- `${CLAUDE_PLUGIN_ROOT}` resolves to the plugin's own installed code, so
  `dist/init.cjs` carries every dependency inlined (no `node_modules` to find).
- The bundle resolves the **target project directory** from
  `CLAUDE_PROJECT_DIR` (falling back to the current working directory), so all
  artifacts land in the **user's project**, never in the plugin cache.
- **Note (TASK-046):** answers-mode automatically skips the CLI's interactive
  confirmation prompt — do NOT pass `--yes` (it is irrelevant here and would be
  redundant). The conversational playback in the Confirmation step above is the
  sole gate; the CLI never double-confirms in this mode.

## Step 4 — Confirm the artifacts and explain next steps

On success the bundle writes, in the user's project directory:

- `PROJECT.md` — the project's identity + stack + definition sections (`## Problem`,
  `## Goals`, `## Scope (in)`, `## Scope (out)`), with machine-readable frontmatter.
- `.claude/agents/project-context.md` — the per-project agent briefing the
  subagents read before working.
- A seeded starter backlog under `tasks/` (TASK-NNN.json files derived from the
  primary use cases, all carrying the `seed` label).
- A session bundle under `state/sessions/<id>/` plus the `state/session.json`
  pointer.

Re-running is **idempotent**: if `PROJECT.md` already exists the bundle prints a
one-line summary and exits without re-prompting, without overwriting
`PROJECT.md`, and without duplicating the seeded backlog. Tell the user they can
now start a chat with the orchestrator and ask it to plan the first phase.
