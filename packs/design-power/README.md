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
