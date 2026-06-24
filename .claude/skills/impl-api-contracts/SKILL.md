---
name: impl-api-contracts
description: Generate the API_CONTRACTS manifest — an endpoint table by module (method, path, auth, request/response shapes, cache keys, invalidation). Load before implementing endpoints or data fetching on a core ticket. Vendored Spine skill, gated by verification_tier (src/manifest-policy.js).
---

## Sources & gate (hivemind)

Vendored from implementation-engine. In hivemind the "context" this skill reads is the project's
knowledge surface — `PROJECT.md`, the wisearcher brain graph (`kb_search`/`kb_answer`, or the local
`knowledge/` KB when the brain is offline), and the ticket's scope + acceptance criteria. Where the
body below refers to `context/<file>.md`, read the equivalent from that surface. Output goes to
`implementation/API_CONTRACTS.md`.

**Gate:** required for **core** tickets (`verification_tier` tdd / tests-after), **skipped** for
`uat-only` glue — see `src/manifest-policy.js` (`requiresManifest`). Generate/update it BEFORE code;
the reviewer treats a missing required manifest as a HIGH finding. Preserve epistemic markers
(`[EXPLICIT]`/`[INFERRED:strong|weak]`/`[ASSUMED]`) and respect source tiers.

---

# impl-api-contracts

Generates `implementation/API_CONTRACTS.md` — an inferred REST endpoint table per module, derived from the KB scope and integration context.

## Read first

Read these files from `context/` (and only from `context/`):
- `context/integration.md` — external integrations, data flows, API communication patterns
- `context/technical.md` — API protocol decisions, auth mechanism, caching strategy
- `context/scope.md` — which features/modules exist and what data they operate on
- `context/estimation.md` — work blocks to ensure all modules are covered
- `context/gaps.md` — open gaps that block endpoint definition

## Output: `implementation/API_CONTRACTS.md`

Organize by module (one section per scope item S-##). For each inferred endpoint:

```markdown
## <Module Name> (S-##)

| Method | Path | Description | Auth | Request | Response | Cache key | Notes |
|--------|------|-------------|------|---------|----------|-----------|-------|
| GET | /campaigns | List campaigns with filters | Bearer | `?status=&brand=` | `Campaign[]` | `["campaigns", filters]` | |
| POST | /campaigns/:id/apply | Submit campaign application | Bearer | `{ proposal }` | `Application` | — | invalidates campaigns list |
```

### Endpoint field rules
- **Method + Path**: infer from feature semantics. If unknown, write `[MISSING_INFO]`
- **Auth**: "Bearer" if the feature requires authentication; "Public" if not; `[MISSING_INFO]` if unknown
- **Request**: describe shape in compact TypeScript-like notation or plain English; use `[MISSING_INFO]` if blocked by a gap
- **Response**: same as request
- **Cache key**: suggest a query key using array notation (e.g., `["campaigns", id]`); use `—` for mutations
- **Notes**: invalidation rules, polling interval, or link to a gap (G-##)

## Third-party integrations

After the module table, add a section for non-REST integrations (push notifications, analytics, crash reporting) describing the integration pattern and any open gaps.

## Rules

- Do not invent endpoint shapes. Infer from feature semantics and mark as `[INFERRED]`.
- If an endpoint is entirely unknown, write a placeholder row with `[MISSING_INFO]` and cite the gap.
- Do not assume a specific HTTP client library — say "HTTP client" not "Axios" unless quoting an ADR decision.
- Reference gaps (G-##, GT-##) from `context/gaps.md` wherever they block an endpoint definition.

## After writing

Report: total endpoints inferred, modules covered, number of `[MISSING_INFO]` entries, and which gaps most affect completeness.
