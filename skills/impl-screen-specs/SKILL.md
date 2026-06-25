---
name: impl-screen-specs
description: Generate the SCREEN_SPECS manifest — a per-screen specification (components, data, API calls, user actions, states, i18n). Load when a core (tdd/tests-after) ticket must blueprint screens before UI code. Vendored Spine skill, gated by verification_tier (src/manifest-policy.js).
---

## Sources & gate (hivemind)

Vendored from implementation-engine. In hivemind the "context" this skill reads is the project's
knowledge surface — `PROJECT.md`, the wisearcher brain graph (`kb_search`/`kb_answer`, or the local
`knowledge/` KB when the brain is offline), and the ticket's scope + acceptance criteria. Where the
body below refers to `context/<file>.md`, read the equivalent from that surface. Output goes to
`implementation/SCREEN_SPECS.md`.

**Gate:** required for **core** tickets (`verification_tier` tdd / tests-after), **skipped** for
`uat-only` glue — see `src/manifest-policy.js` (`requiresManifest`). Generate/update it BEFORE code;
the reviewer treats a missing required manifest as a HIGH finding. Preserve epistemic markers
(`[EXPLICIT]`/`[INFERRED:strong|weak]`/`[ASSUMED]`) and respect source tiers.

---

# impl-screen-specs

Generates `implementation/SCREEN_SPECS.md` — a per-screen specification covering every screen in the project scope.

## Read first

Read these files from `context/` (and only from `context/`):
- `context/scope.md` — identifies all scope items (S-##) and their feature areas
- `context/technical.md` — navigation structure, architecture patterns, component conventions
- `context/execution.md` — phase assignments per feature area

## Output: `implementation/SCREEN_SPECS.md`

Write one entry per screen. Derive the screen list from the scope items (S-AUTH, S-HOME, S-CAMP, S-WORK, S-CHAT, S-PROF, S-SET, S-PAY, S-REP) and expand each into its constituent screens.

### Format for each screen

```markdown
## <Screen Name>

**Scope item**: S-##
**Phase**: P#
**Navigation path**: <tab> → <stack position>  (e.g., Campaigns tab → Campaign Detail)

### Components
- <Canonical component name from COMPONENT_CATALOG>: <brief purpose>
  (reference catalog entries by name — never describe a bespoke date/select/etc.)

### Data
- <what data this screen needs, where it comes from (API / state store / prop)>

### API calls
- <METHOD /path> — <purpose> [gap: G-## if blocked]

### User actions
- <action> → <result or navigation target> — span `<feature.action>`

### States
- **Loading**: <description>
- **Empty**: <description>
- **Error**: <description> — traced + logged (see Observability standard)
- **Populated**: <description>

### i18n keys
- `<key>`: "<default text>"

### Open gaps
- <G-## or [MISSING_INFO] if something cannot be determined from context>
```

## Rules

- Apply `.claude/shared/UI_CONSISTENCY.md`: reference canonical components by catalog name;
  flag any screen that would need a bespoke variant of a shared input.
- Apply `.claude/shared/OBSERVABILITY.md`: every user action names its trace span; the Error
  state is traced + logged.
- Cover every screen derivable from scope. If a scope item maps to multiple screens (e.g., S-WORK has 7 workflow steps), create one entry per step.
- Use generic terms for architecture references ("state store", "HTTP client") except when an ADR decision is being cited — in that case label it clearly.
- Do not invent API endpoints. If the endpoint is unknown, write `[MISSING_INFO] endpoint TBD` and cite the relevant gap.
- Mark any uncertainty with `[INFERRED]` or `[ASSUMED]` as appropriate.
- Preserve `[MISSING_INFO]` for anything that cannot be derived from context.

## After writing

Report: total screen count, scope items covered, number of `[MISSING_INFO]` markers found.
