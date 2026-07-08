# Design Profile Subsystem — Diseño Poderoso, Phase E (DRAFT / PROPOSED)

**Status: DRAFT PROPOSAL — not approved, not scheduled.** This document is a from-first-principles
design produced by the Researcher subagent because the original interview questions and scoring
formula referenced by `docs/design/addon-packs.md` §10 exist only in an external discussion that is
not captured in this repo. Nothing here is final until a human reviews it. Where a decision was a
judgment call rather than something directly implied by `addon-packs.md` / `addon-packs-plan.md`,
it is flagged in §6 (Open questions).

**Companions:** `docs/design/addon-packs.md` (architecture, §8 pack descriptor, §8.1 exclusion
rules), `docs/design/addon-packs-plan.md` (Phase E sits between Phase D — registration hook — and
Phase F — the `design-power` pack descriptor itself). **Compatibility constraint honored:** every
question below uses the exact shape the intake engine implements — `{ id, type, prompt, enum?,
required?, when?(answers) }`, types limited to `string | number | enum | multi` (verified against
`src/question-engine.js:132-176`), `when` predicates reference only prior answers (the engine has
no lookahead), and `multi` answers already arrive as a deduped array — no separate normalizer step
is needed (`src/question-engine.js:157-171`), unlike the free-string `goals`/`scope_in`/`scope_out`
fields in `src/question-library.js` which route through `bin/init.js`'s normalizer instead.

---

## 1. The beauty × functionality model, formalized

Two independent ordinal axes, each `0–3`:

| Value | Functionality axis (`F`) | Beauty / design-ambition axis (`B`) |
|---|---|---|
| 0 | Trivial — a handful of screens/flows, nothing real depends on it | Utilitarian — internal tool, "ugly is fine" |
| 1 | Modest — several flows, low stakes | Tidy — clean, professional, generic-template-level is fine |
| 2 | Substantial — many screens/flows, real data, real users depend on it | Branded — distinctive, on-brand, competitive with polished products in its category |
| 3 | Complex — many interacting flows, real-time/multi-user, integrations, mission-critical | Signature — best-in-class, art-directed; the design *is* a differentiator |

The four corners from the human's framing map onto this grid as **"high" = axis value ≥ 2**:

| Quadrant | F | B |
|---|---|---|
| horrible & functional | high (≥2) | low (≤1) |
| beautiful & simple | low (≤1) | high (≥2) |
| beautiful & functional | high (≥2) | high (≥2) |
| horrible & simple | low (≤1) | low (≤1) |

**Tier rule** (the human's rough proposal, formalized — this is the canonical tier gate, not the
additive score below):

```
fHigh = F >= 2
bHigh = B >= 2

if fHigh && bHigh  → COMPLETO   ("both axes are high — needs real functional depth AND real design craft at once")
if fHigh || bHigh  → MEDIO      ("exactly one axis is high — a lopsided project, all-function-no-polish or all-polish-no-function")
otherwise          → LIGERO     ("neither axis rises above low — modest either way")
```

A secondary **score** (`F + B`, range 0–6) is also returned for reporting/ordering, but it is
**descriptive only** — two answer sets can share a score while landing in the same tier via
different axis compositions (see worked example 6 in §4). The tier gate is always the `fHigh`/`bHigh`
rule above, never the raw sum.

---

## 2. The intake gate question

Added once, unconditionally (no `when` — asked of every project regardless of `project_type`,
because design ambition is orthogonal to project type: a CLI tool's TUI or a data pipeline's
dashboard can still be design-heavy). This keeps the pack decoupled per `addon-packs.md` §5 — it is
registered via the pack's own `profile.base_questions` (through the Phase D registration hook), not
spliced into `src/question-library.js`'s `COMMON_QUESTIONS` directly.

```js
{
  id: 'design_heavy',
  type: 'enum',
  enum: ['yes', 'no'],
  prompt:
    'Does this project have a visual, human-facing interface that needs deliberate ' +
    'design work — as opposed to a pure API, CLI, backend service, or script? ' +
    '(This decides whether the design-power pack engages at all.)',
}
```

`answer === 'no'` short-circuits: the Fase 0–1 interview never runs, `scoreComplexity` returns
`LIGERO` / score `0` / all activations `false`, and the pack does nothing further this project.
`answer === 'yes'` gates every question in §3.

---

## 3. The Fase 0–1 conditional interview

Ten questions, ordered so every `when` predicate only ever looks backward (engine-compatible). Two
are doubly-conditional (gated on both `design_heavy` and a same-phase prior answer).

```js
const FASE_1_QUESTIONS = [
  {
    id: 'estimated_screens',
    type: 'number',
    prompt:
      'Roughly how many distinct user-facing screens/flows will this need at launch? ' +
      '(best estimate; a single-page tool = 1)',
    when: (a) => a.design_heavy === 'yes',
  },
  {
    id: 'stakes',
    type: 'enum',
    enum: ['low', 'real'],
    prompt:
      "What's the deployment reality? 'low' = personal project/prototype/experiment, " +
      "no one depends on it working. 'real' = an internal team relies on it daily, or " +
      'it has public/paying users and uptime matters.',
    when: (a) => a.design_heavy === 'yes',
  },
  {
    id: 'design_ambition',
    type: 'enum',
    enum: ['utilitarian', 'tidy', 'branded', 'signature'],
    prompt:
      'What visual bar does this need to hit? utilitarian = internal tool, just needs ' +
      'to be usable. tidy = clean and professional, generic is fine. branded = ' +
      'distinctive, competitive with polished products in its category. signature = ' +
      'best-in-class, art-directed, a differentiator in itself.',
    when: (a) => a.design_heavy === 'yes',
  },
  {
    id: 'ui_framework',
    type: 'enum',
    enum: ['react', 'vue', 'other'],
    prompt: 'Which framework renders the UI? (drives component-registry routing)',
    when: (a) => a.design_heavy === 'yes',
  },
  {
    id: 'has_canvas_render',
    type: 'enum',
    enum: ['yes', 'no'],
    prompt:
      'Does the project render through a canvas/game-engine surface (Phaser, WebGL, ' +
      'Three.js, etc.) rather than plain DOM?',
    when: (a) => a.design_heavy === 'yes',
  },
  {
    id: 'ui_outside_canvas',
    type: 'enum',
    enum: ['yes', 'no'],
    prompt:
      'Is there any DOM UI (HUD, menus, settings screens, overlays) outside that canvas?',
    when: (a) => a.design_heavy === 'yes' && a.has_canvas_render === 'yes',
  },
  {
    id: 'motion_required',
    type: 'enum',
    enum: ['yes', 'no'],
    prompt:
      'Does this need real animation/motion work — transitions, micro-interactions, ' +
      'choreographed sequences — beyond basic hover states?',
    when: (a) => a.design_heavy === 'yes',
  },
  {
    id: 'motion_layer',
    type: 'enum',
    enum: ['dom', 'canvas', 'both'],
    prompt: 'Where does that motion primarily live?',
    when: (a) => a.design_heavy === 'yes' && a.motion_required === 'yes',
  },
  {
    id: 'needs_research',
    type: 'enum',
    enum: ['need-research', 'have-direction'],
    prompt:
      'Do you need competitive/visual reference research (mood boards, competitor UI ' +
      'audits) before design starts, or do you already have clear direction (existing ' +
      'brand, mockups, style guide)?',
    when: (a) => a.design_heavy === 'yes',
  },
  {
    id: 'assets_required',
    type: 'multi',
    enum: ['illustrations', 'icons-custom', 'photography', '3d-renders', 'game-sprites-tiles', 'none'],
    prompt: 'Which custom visual assets does this need? (comma-separated; pick from the listed values)',
    when: (a) => a.design_heavy === 'yes',
  },
];
```

Why these ten and no more: `estimated_screens` + `stakes` resolve `F`; `design_ambition` resolves
`B` directly; the remaining six are pure activation variables that cannot be derived from the axes
(framework routing, canvas gating, motion layer, research need, asset kinds) — each gates a
mutually-exclusive resource choice in §5, so none can be dropped without losing that resource
decision. `estimated_screens` as a raw number (rather than a bucketed enum) mirrors standard
design-intake practice of scoping by page/screen count before estimating effort.

---

## 4. The pure scoring function

```js
function bucketScreens(n) {
  const v = Number.isFinite(n) ? n : 1;
  if (v <= 2) return 0;
  if (v <= 7) return 1;
  if (v <= 20) return 2;
  return 3;
}

const DESIGN_AMBITION_SCORE = { utilitarian: 0, tidy: 1, branded: 2, signature: 3 };

function scoreComplexity(answers) {
  if (answers.design_heavy !== 'yes') {
    return {
      tier: 'LIGERO',
      score: 0,
      axes: { functionality: 0, beauty: 0 },
      activations: {
        design_heavy: false, framework: null, is_canvas: false,
        ui_outside_canvas: null, motion_required: false, motion_layer: null,
        needs_research: false, assets: false, assets_list: [],
      },
    };
  }

  let F = bucketScreens(answers.estimated_screens);
  if (answers.stakes === 'real' && F === 0) F = 1;   // production stakes floor the axis at 1
  F = Math.min(F, 3);

  const B = DESIGN_AMBITION_SCORE[answers.design_ambition] ?? 0;

  const fHigh = F >= 2;
  const bHigh = B >= 2;
  const tier = fHigh && bHigh ? 'COMPLETO' : (fHigh || bHigh) ? 'MEDIO' : 'LIGERO';
  const score = F + B; // 0-6, descriptive/ordering only — NOT the tier gate

  const isCanvas = answers.has_canvas_render === 'yes';
  const uiOutsideCanvas = isCanvas ? answers.ui_outside_canvas === 'yes' : true;
  const motionRequired = answers.motion_required === 'yes';
  const motionLayer = motionRequired ? (answers.motion_layer ?? 'dom') : null;
  const needsResearch = answers.needs_research === 'need-research';
  const assetsList = Array.isArray(answers.assets_required)
    ? answers.assets_required.filter((a) => a !== 'none')
    : [];

  return {
    tier,
    score,
    axes: { functionality: F, beauty: B },
    activations: {
      design_heavy: true,
      framework: answers.ui_framework ?? 'other',
      is_canvas: isCanvas,
      ui_outside_canvas: uiOutsideCanvas,
      motion_required: motionRequired,
      motion_layer: motionLayer,
      needs_research: needsResearch,
      assets: assetsList.length > 0,
      assets_list: assetsList,
    },
  };
}
```

Pure and deterministic: only reads `answers`, no I/O, no randomness, no hidden state.

### Worked examples (one per quadrant + two edge cases)

| # | Quadrant / case | Key inputs | F | B | Tier | Score |
|---|---|---|---|---|---|---|
| 1 | horrible & functional (internal admin, 25 screens, real users, utilitarian) | `estimated_screens=25, stakes=real, design_ambition=utilitarian` | 3 | 0 | **MEDIO** | 3 |
| 2 | beautiful & simple (1-page landing, signature bar, low stakes) | `estimated_screens=1, stakes=low, design_ambition=signature` | 0 | 3 | **MEDIO** | 3 |
| 3 | beautiful & functional (15-screen consumer SaaS, branded, real stakes) | `estimated_screens=15, stakes=real, design_ambition=branded` | 2 | 2 | **COMPLETO** | 4 |
| 4 | horrible & simple (throwaway script — gate itself) | `design_heavy=no` | 0 | 0 | **LIGERO** | 0 |
| 5 | boundary — modest on both axes despite entering the interview | `estimated_screens=5, stakes=low, design_ambition=tidy` | 1 | 1 | **LIGERO** | 2 |
| 6 | tie-break — same score, different composition, same tier | 6a: `screens=12, ambition=tidy` (F2,B1) vs 6b: `screens=1, stakes=real, ambition=branded` (F1,B2) | 2/1 | 1/2 | **MEDIO** / **MEDIO** | 3 / 3 |

Example 6 is the reason `score` is not the tier gate: 6a and 6b sum to the same value via opposite
axis compositions, yet the resource table in §5 activates *different* pipeline steps for each
(6a needs `design-system`, not `art-direction`; 6b is the reverse) — something a single scalar
threshold could not distinguish.

---

## 5. Resource / step activation

Rather than a tier-only lookup, activation is expressed as predicates over `{ tier, axes,
activations }` — every predicate is exactly one of the fields `scoreComplexity` already returns, so
no extra derived state needs to travel with the result.

### 5.1 Pipeline steps (of the 9 in `addon-packs.md` §8)

| Step | ON when | Rationale |
|---|---|---|
| `reference` | `design_heavy === true` (any tier) | Cheap baseline, always useful once the pack engages at all |
| `research` | `activations.needs_research` | Independent of tier — a LIGERO project can still ask for competitive research, a COMPLETO one can skip it if direction is already set |
| `art-direction` | `axes.beauty >= 2` (`bHigh`) | Mood/palette/type work only matters once the beauty bar is genuinely high |
| `design-system` | `axes.functionality >= 2` (`fHigh`) | Tokens/consistency scaffolding earns its cost only once there's enough surface (screens/flows) to need consistency |
| `implementation` | `design_heavy === true` (any tier) | Always — something is being built |
| `motion` | `activations.motion_required` | Independent of tier, same reasoning as `research` |
| `assets` | `activations.assets` | Independent of tier |
| `polish` | `axes.beauty >= 2` (`bHigh`) | Detail pass exists to serve the beauty axis; same predicate as `art-direction` (direction defines it, polish applies it) |
| `testing` | `design_heavy === true` (any tier) | Always verify what was built |

Because `tier === 'COMPLETO'` is *defined* as `fHigh && bHigh`, COMPLETO always lights up
`art-direction` + `design-system` + `polish` together, and MEDIO always lights up **exactly one**
of `{art-direction, polish}` or `{design-system}` depending on which axis is high — this is a
restatement of the tier rule in §1, not a new rule.

### 5.2 §8 resources

| Resource | ON when | Source |
|---|---|---|
| `frontend-design` (skill) | `design_heavy === true` (any tier) | hard prerequisite per `addon-packs.md` §2.3 example |
| `ui-ux-pro-max` (skill) | `tier !== 'LIGERO'` | descriptor comment "`tier>=MEDIO`" |
| `shadcn-vue` | `framework === 'vue' && ui_outside_canvas === true` | §8.1 routing rule |
| `shadcn/ui` (react) | `framework === 'react' && ui_outside_canvas === true` | implied counterpart of the above routing rule |
| `gsap` | `motion_required && motion_layer !== 'canvas'` (i.e. `dom` or `both`) | descriptor comment "`motion_required && motion_layer==dom`" |
| `firecrawl` (MCP) | `needs_research === true` | tier-independent per descriptor comment (no tier qualifier given, unlike openart/playwright) |
| `openart` (MCP) | `tier === 'COMPLETO' && assets === true` | descriptor comment "`COMPLETO && assets`" |
| `playwright` (MCP) | `tier === 'COMPLETO' && ui_outside_canvas === true` | descriptor comment "`COMPLETO && web UI`", interpreted as "a DOM surface exists to automate" — flagged in §6 |

Neither `shadcn-vue` nor `shadcn/ui` activates when `framework === 'other'` or `ui_outside_canvas
=== false` — the canvas-gating exclusion from §8.1 ("disable shadcn-vue, DOM polish, and DOM
Playwright" when `ui_outside_canvas == false`) is honored directly by the shared
`ui_outside_canvas` predicate on all three DOM-only resources.

### 5.3 Concrete table (tier × common activation combos)

| Case | Tier | Steps ON | Resources ON |
|---|---|---|---|
| Design-off | `design_heavy=no` | (none) | (none) |
| LIGERO, no flags | F≤1, B≤1, no motion/assets/research | reference, implementation, testing | frontend-design |
| MEDIO — function-heavy (e.g. worked example 1) | F≥2, B≤1 | reference, design-system, implementation, testing | frontend-design, ui-ux-pro-max, (+shadcn/shadcn-vue if `ui_outside_canvas`) |
| MEDIO — beauty-heavy (e.g. worked example 2) | F≤1, B≥2 | reference, art-direction, implementation, polish, testing (+research/motion/assets per flags) | frontend-design, ui-ux-pro-max, (+shadcn/shadcn-vue, +gsap if DOM motion), firecrawl (if `needs_research`) |
| COMPLETO (e.g. worked example 3) | F≥2, B≥2 | all 9 steps active where their own flag also holds (research/motion/assets still flag-gated) | frontend-design, ui-ux-pro-max, shadcn/shadcn-vue (if applicable framework+DOM), gsap (if DOM motion), firecrawl (if research), openart (if assets), playwright (if DOM UI) |

---

## 6. Open questions / assumptions flagged for human review

1. **Axis weighting is 1:1.** `score = F + B` treats functionality and beauty as equally weighted.
   Since this is specifically the *design* pack, an argument could be made to weight `B` higher
   (it drives most of the pack's own cost). Not applied here — the tier gate is threshold-based, not
   weight-based, so this only affects the descriptive `score`, but flagging in case downstream
   tooling reads `score` as more than descriptive.
2. **`design_heavy` is asked unconditionally**, with no `when` tied to `project_type`. An
   alternative would skip it for definitely-headless types (e.g. `data-pipeline`). Chose
   unconditional to avoid coupling the pack to the current `project_type` taxonomy, per
   `addon-packs.md` §5's non-coupling principle — but this means every project sees one extra
   question even when a UI is implausible.
3. **`estimated_screens` bucket thresholds (`≤2 / ≤7 / ≤20 / >20`) and the "high" cutoff (`≥2`
   on a 0–3 scale) are judgment calls**, not derived from a cited benchmark — general
   design-intake practice treats screen/page count as a standard scoping signal, but the exact
   bucket boundaries would benefit from calibration against a few real Hivemind-adjacent projects
   once this ships.
4. **Canvas-only motion has no resource.** `gsap` is DOM-only per the descriptor; when
   `motion_layer === 'canvas'`, `motion_required` still turns the `motion` step ON but no §8
   resource activates for it — the assumption is that canvas-native motion (e.g. Phaser tweens)
   is out of this design pack's scope and handled by the game framework itself. Needs an explicit
   call: either add a canvas-motion resource in a later wave, or document this as a known gap in
   the pack descriptor.
5. **`playwright` gated on `ui_outside_canvas === true`** is my interpretation of the descriptor's
   "`COMPLETO && web UI`" comment — the source phrase doesn't literally say `ui_outside_canvas`.
   If "web UI" was meant to include canvas-rendered pages too, this predicate is too narrow.
6. **MEDIO has two internal "flavors"** (function-heavy vs beauty-heavy) that this spec derives
   from `axes` at read time rather than returning as an explicit field. If the resource-table logic
   ends up needing the flavor in more places, consider adding a non-breaking `activations.flavor:
   'function' | 'beauty' | 'both' | 'neither'` to the return shape rather than re-deriving it
   ad hoc at every call site.
7. **Where `perfil_proyecto`/`tier` land in `PROJECT.md`** is Phase A/D territory
   (`src/project-md.js` `SPECIAL_FRONTMATTER_IDS`, following the existing `agent_models` inline-object
   pattern per `addon-packs-plan.md` §3) — not specified further here, since it's out of this
   deliverable's scope, but flagged so Phase E tickets don't silently re-invent it.
8. **No golden/reference "worked example" set exists yet** in the repo to validate this scoring
   function against real prior Hivemind design decisions — the six examples in §4 are self-authored
   for coverage, not backtested against a known-good corpus.

---

## Sources

- `docs/design/addon-packs.md` (this repo) — pipeline steps, §8 resource descriptor, §8.1 exclusion
  rules, the intake trigger shape.
- `docs/design/addon-packs-plan.md` (this repo) — Phase E scope boundary, insertion points, license
  and reconciler context.
- `src/question-library.js`, `src/question-engine.js` (this repo) — question object shape, `when`
  predicate contract, engine-native `number`/`enum`/`multi` type handling (verified by reading the
  `case` blocks directly rather than assumed).
- General design-intake practice (screen/page-count as a standard scoping question; visual-bar /
  brand-distinctiveness as a standard branding-questionnaire question) — see search results:
  [Website Design Questionnaire](https://www.sliderrevolution.com/resources/website-design-questionnaire/),
  [Branding Questionnaire: 35 Questions](https://manyrequests.com/blog/branding-questionnaire-for-clients/).
- Design-system maturity dimensions (design quality, tooling, governance) informed the step
  taxonomy's separation of `design-system` from `art-direction`/`polish` as distinct concerns — see
  [Design System Maturity Model](https://www.designsystems.one/foundations/maturity-model),
  [Elevating design systems: a holistic framework for maturity](https://uxplanet.org/elevating-design-systems-a-holistic-framework-for-maturity-7ce70d295cec).
