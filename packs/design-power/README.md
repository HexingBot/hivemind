See `references/design-build-workflow.md` for the vendor-neutral anti-slop design build-workflow guidance (TASK-177).

# design-power pack — resource notes (FP-2 / TASK-130)

`descriptor.json` is the production descriptor for the "Diseño Poderoso" pack
(`docs/design/addon-packs.md`). This file records three orchestrator product
decisions about `resources[]` that don't fit as schema fields
(`state/pack-descriptor.schema.json` is `additionalProperties: false` on each
resource entry, so there is no `notes` field to carry them inline).

## gsap — dropped from `resources[]`

`src/design-profile.js#resourceActivations` still exposes a `gsap` activation
key (`motion_required && motion_layer !== 'canvas'`), but no `gsap` entry
exists in this descriptor's `resources[]`. gsap is a plain npm animation
library, not a skill/mcp/plugin (`pack-descriptor.schema.json`'s `kind` enum
has no fit for it) — it is added as an ordinary project dependency by the
`implementation`/`motion` pipeline steps, not reconciled as a pack resource.

## openart — omitted, manual OAuth connect

`resourceActivations` also carries an `openart` key (`tier==COMPLETO &&
assets`), but this descriptor deliberately has no `openart` resource entry.
`pack-descriptor.schema.json` requires every resource's `pin` to be a
non-empty exact commit/version — openart has no trustworthy pin researched
for this ticket (it is an OAuth-connected SaaS, not a pinnable
package/skill/plugin), and fabricating one would violate the "never a range,
never invented" pin discipline (`docs/design/addon-packs-plan.md` §2). Until
a real integration path is researched, openart is a **manual step**: the
human connects it via OAuth outside the reconciler when the `assets`
pipeline step needs it on a `COMPLETO`-tier project.

## Wave-2 TRACKED (non-assimilated) resources — Impeccable, Taste Skill, Higgsfield, 21st.dev Magic (TASK-178)

Human decision (2026-07-23): adopt four external design tools referenced by
`references/design-build-workflow.md` (TASK-177's vendor-neutral process doc)
as **TRACKED** resources in `resources[]` — recorded for provenance/visibility,
**deliberately NOT assimilated**. The team accepts the supply-chain trade-off
of staying current with upstream rather than vendoring a frozen owned copy
(contrast with `ui-ux-pro-max`, which IS assimilated). The human runs every
actual install/auth command; the descriptor only records intent.

**Modeling choice — `kind:plugin`/`kind:mcp`, never `kind:skill`.** Only
`kind:"skill"` resources are ever planned for install/remove/replace by
`src/pack-reconcile.js#plan()` (Wave-1 scope) or materialized by
`src/pack-apply.js`. A tracked SKILL recorded as `kind:skill` would make the
reconciler try to own/materialize it — and fail, since no assimilated copy
exists under `assimilated-skills/`. Recording Impeccable and Taste Skill as
`kind:"plugin"` (matching `frontend-design`'s own precedent) sidesteps this
entirely: `plan()` structurally only ever surfaces a non-skill resource in its
`report` array (`blocking` iff `required:"hard"`), never installs/removes it.
Higgsfield and 21st.dev Magic are `kind:"mcp"` for the same reason.

**Not wired into `resourceActivations()`.** Unlike `frontend-design`/
`ui-ux-pro-max`/`shadcn`/`firecrawl`/`playwright` (each gated by a real
predicate in `src/design-profile.js#resourceActivations`), these four
resources have no corresponding activation key there, and their
`activate_when` strings are descriptive-only (never the exact `"always"`
sentinel `src/pack-resources.js#resolveDesired` treats as an unconditional
keep — `tests/pack-resources.spec.js` has a standing regression lock proving
no design-power resource ever uses that exact string). Net effect:
`resolveDesired`/`reconcile-apply` never proposes them for install and never
even lists them in the `report` array — they are a pure, inert provenance
record in `descriptor.json` today. `tests/design-power-descriptor.spec.js`
explicitly documents and locks this exclusion (`TRACKED_NOT_GATED_IDS`).

**Impeccable** (`id: impeccable`, `kind:plugin`) — `github.com/pbakaus/impeccable`,
Apache-2.0, no auth. Install: `/plugin marketplace add pbakaus/impeccable`
(tracks upstream `latest`). Pin recorded: release tag `skill-v4.0.2`
(commit `fc2e694afca1ac0cc384b4fe56bab3335fea7912`), the newest real dated
release tag at time of writing — lowest-risk of the four (a real
marketplace-published plugin with tagged releases).

**Taste Skill** (`id: taste-skill`, `kind:plugin`) — `github.com/Leonxlnx/taste-skill`,
MIT, no auth. Install: `npx skills add https://github.com/Leonxlnx/taste-skill`
— note this resolves through a third-party, ambiguous `npx skills` CLI
ecosystem, not an Anthropic-official installer. CAUTION: the repo has no
release tags, only a moving `taste-skill-v2` "experimental" branch — the pin
recorded (`e988add20dab0fa97d7a76781c48961c8184288e`) is an exact commit SHA
on the `main` branch, **never** the `taste-skill-v2` branch/label (repo
etiquette: never a floating ref). The repo name also collides with several
unrelated forks (`suboss87/…`, `senlindesign/…`, `nxpatterns/…`) — the pinned
`origin` is exactly `Leonxlnx/taste-skill`; do not substitute a fork.

**Higgsfield MCP** (`id: higgsfield`, `kind:mcp`) — `higgsfield.ai`, hosted
endpoint `https://mcp.higgsfield.ai/mcp`, proprietary (no OSS license).
Install: `claude mcp add --transport http --scope user higgsfield
https://mcp.higgsfield.ai/mcp`. Requires **OAuth login + paid credits**
(different trust category from the other three — a live authenticated paid
service, not a pinnable artifact). **Unpinnable caveat**: a hosted remote
endpoint has server-side versioning this descriptor cannot observe or freeze,
so `pin` cannot be an exact commit/version the way every other resource's can.
The recorded pin, `https://mcp.higgsfield.ai/mcp (endpoint@2026-07-23)`, is a
dated provenance marker (the endpoint URL plus the date this entry was
verified) rather than a real immutable pin — it documents *when* this
resource was last confirmed live and *what* it pointed to, not a reproducible
version. Re-verify the date marker periodically; a live paid/authenticated
endpoint is a fundamentally different trust category than every other pinned
resource in this descriptor.

**21st.dev Magic** (`id: 21st-dev-magic`, `kind:mcp`) — `github.com/21st-dev/cli`
(server: `21st-dev/magic-mcp`), MIT. Install:
`npx @21st-dev/cli@1.9.0 install claude --api-key <key>`. Requires an
**API key** (free tier: 2 runs/day). Pin recorded is the exact npm version
`1.9.0` (verified via `npm view @21st-dev/cli version` / the registry
`dist-tags.latest`, 2026-07-23) — never `@latest`, and never the deprecated,
older `@21st-dev/magic@0.1.0` package.

Cross-reference: TASK-177's `references/design-build-workflow.md` names the
process patterns these tools implement (taste-curation, reference-image
generation, component-generation, tweak-bar harness) without naming a vendor;
this section is the human-gated adoption decision for the vendors themselves.

## frontend-design — honestly-flagged provisional pin

`frontend-design` ships with `pin: "marketplace-latest (Wave-2; human to
ratify)"` rather than an exact commit/version. This is deliberate, not an
oversight: the researched source for this resource is the official Claude
plugin marketplace listing, which is Wave-2/TUI-only tooling at the time of
this ticket, and no exact ratified pin was available to research. The
provisional string is non-empty (satisfies the schema) and self-documents
that a human must ratify the exact pin before this resource activates
autonomously under `design_pipeline` trust (`docs/design/addon-packs.md` §4 —
installs stay interactive-only, hard-required resources doubly so, until this
is resolved).
