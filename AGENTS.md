# hivemind

## Workflow Rule
**Never write code without a plan.** Before any implementation:
1. Call `read_knowledge_base` with no arguments to load the full knowledge base.
2. Update `.knowledge/` files to reflect the design intent via `write_knowledge_file`.
3. Call `write_plan` to record the implementation plan in `PLAN.md`.
Only then write code — in the order defined in `PLAN.md`.

## Knowledge Standard
The KB is split into `canonical/` (facts verifiable in source) and `derived/` (analysis built on them); `meta/` holds the source-tier table and guardrails. Every claim carries a marker — [EXPLICIT] (cite `path`/`path:line`), [INFERRED:strong|weak], [ASSUMED], [MISSING_INFO] — and canonical always wins on conflict. After writing knowledge files, run `verify_knowledge`.

## Observability Gate
Every feature must have logging, tracing, and metrics defined in `.knowledge/conventions.md ## Observability` before coding starts.

## Environment Rule
Always use Docker for services, databases, and tools — never install software directly on the host.

## Security
- Never read `.env` files or any files that may contain secrets (e.g. `.env.local`, `.env.production`, `*.env`). Use `.env.example` files to understand available variables instead.

## Collaboration
- Don't take the user's statements at face value when something seems off. If a reported behavior contradicts the code, investigate before acting. Push back when the reasoning is unclear or the proposed fix doesn't match the actual problem.
- The goal is to make the user better, not just to complete tasks. Point out when an approach has a flaw, when a simpler solution exists, or when a change is unnecessary.

## Build & Verify
- `<add build command>`
- `<add verify command>`

## Purpose
<fill in project purpose — see .knowledge/architecture.md>

## Key Constraints
- <fill in from .knowledge/architecture.md ## Constraints>
- <fill in from .knowledge/conventions.md ## Constraints>
