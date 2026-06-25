---
name: impl-state-schemas
description: Generate the STATE_SCHEMAS manifest — server/query state (query-key factory) + UI/local state stores + cache-invalidation rules. Load before implementing state management on a core ticket. Vendored Spine skill, gated by verification_tier (src/manifest-policy.js).
---

## Sources & gate (hivemind)

Vendored from implementation-engine. In hivemind the "context" this skill reads is the project's
knowledge surface — `PROJECT.md`, the wisearcher brain graph (`kb_search`/`kb_answer`, or the local
`knowledge/` KB when the brain is offline), and the ticket's scope + acceptance criteria. Where the
body below refers to `context/<file>.md`, read the equivalent from that surface. Output goes to
`implementation/STATE_SCHEMAS.md`.

**Gate:** required for **core** tickets (`verification_tier` tdd / tests-after), **skipped** for
`uat-only` glue — see `src/manifest-policy.js` (`requiresManifest`). Generate/update it BEFORE code;
the reviewer treats a missing required manifest as a HIGH finding. Preserve epistemic markers
(`[EXPLICIT]`/`[INFERRED:strong|weak]`/`[ASSUMED]`) and respect source tiers.

---

# impl-state-schemas

Generates `implementation/STATE_SCHEMAS.md` — state store definitions, query key factory, and cache invalidation rules.

## Read first

Read these files from `context/` (and only from `context/`):
- `context/technical.md` — state management architecture, caching strategy
- `context/adrs.md` — ADR decisions on state management (ADR-04 and related)
- `context/scope.md` — features that require state (to ensure completeness)

## Output: `implementation/STATE_SCHEMAS.md`

### Section 1: State architecture overview

Summarize the two-layer state model from the KB decisions:
- **Server state** (query cache): what it covers, invalidation strategy, background refresh behavior
- **UI/local state** (state store): what it covers, when to use it vs. the query cache

Note the ADR-decided libraries as project decisions (e.g., "Project decision [ADR-04]: React Query for server state, Zustand for UI state") — but structure the document so it remains readable for any equivalent state management approach.

### Section 2: Server state — query key factory

```markdown
## Query Key Factory

const queryKeys = {
  // Auth
  session: () => ["session"],

  // Campaigns
  campaigns: {
    all: () => ["campaigns"],
    list: (filters) => ["campaigns", "list", filters],
    detail: (id) => ["campaigns", "detail", id],
  },

  // ... one group per module
}
```

Cover every module with server-side data (Auth, Campaigns, Workflow, Payments, Profile, Chat, Reports).

### Section 3: UI state stores

For each store, define:

```markdown
## <StoreName>

**Purpose**: <what UI state this manages and why it can't live in the query cache>

### Shape
{
  <field>: <type>  // <comment if non-obvious>
}

### Actions
- `<actionName>(<params>)` — <what it does>

### Usage
- <which screens or components use this store>
```

### Section 4: Cache invalidation rules

A table mapping mutations to the query keys they invalidate:

| Mutation | Invalidates |
|----------|-------------|
| Apply to campaign | `campaigns.list`, `campaigns.detail(id)` |
| Complete workflow step | `campaigns.detail(id)`, `payments.balance` |
| ... | ... |

## Rules

- Define stores only for state that genuinely cannot live in the query cache (UI toggles, navigation state, in-progress form state, optimistic UI).
- Do not duplicate server state in a UI store.
- Use generic field types (string, number, boolean, array, object) unless a specific shape is known.
- Mark unknown shapes `[MISSING_INFO]`.

## After writing

Report: number of query key groups, number of stores defined, any `[MISSING_INFO]` entries.
