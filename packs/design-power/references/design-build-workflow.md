# Design build-workflow: anti-slop process patterns

Vendor-neutral process guidance for the `design-power` pack's pipeline
(`reference` → `research` → `art-direction` → `design-system` →
`implementation` → `motion` → `assets` → `polish` → `testing`, per
`packs/design-power/descriptor.json`). These six patterns describe **how**
to run that pipeline so the output reads as deliberately designed rather
than generic AI output ("slop"). They are process, not products: none of
this section names or requires a specific third-party tool. The concrete
external tools that implement pieces of this workflow (a taste-curation
skill, a reference-image MCP, a component-generation service, a
tweak-bar dev harness) are tracked as a separate, human-gated adoption
decision in **TASK-178** — see "Cross-reference" at the end of this doc.

## 1. Taste / inspiration library (`reference` step)

Do not one-shot a design from a bare prompt. Before generating anything,
build a small curated reference library:

- **How**: browse a visual-inspiration source (e.g. Dribbble, Pinterest,
  X/Twitter design threads) for the project's design type (marketing
  landing page, SaaS dashboard, portfolio, e-commerce PDP, etc.) and save
  5-15 references that actually match the target feel.
- **Group by design type.** Keep separate mini-libraries per surface —
  a dashboard reference set is not a landing-page reference set.
- **For each saved reference, write down two things**, not just the
  image:
  1. A short **design-vocabulary** description (2-4 phrases): layout
     rhythm, type pairing, color temperature, density, motion cues —
     whatever makes the reference distinctive.
  2. A **reusable image-prompt/brief** that could regenerate something in
     that same family on demand (a one- or two-sentence prompt capturing
     the vocabulary above).
- **Use it as the foundation, not a one-off lookup.** Every later
  generation step (prompt template, hero-image pass, etc.) pulls from
  this library instead of improvising fresh taste each time.

## 2. Four-part prompt template (`art-direction` step)

Every design-generation prompt (whether for a full page, a component, or
a hero image) is composed of four explicit parts, in this order:

1. **Aesthetic / design family** — name the style lane (e.g. "editorial
   brutalist", "soft neumorphic SaaS", "dense data-dashboard") pulled
   from the taste library's vocabulary in step 1.
2. **Reference image(s)** — one or two images from the taste library
   attached or described, with an explicit instruction to match the
   *feel* (composition, density, color temperature, type pairing) and
   never to copy layout or content verbatim.
3. **Intent** — what the surface is for and why, the target audience,
   and the single desired user action (the one thing you want the
   viewer/user to do after seeing it).
4. **Guardrails** — an explicit always/never list. Always-list items are
   non-negotiable constraints (brand color, accessibility minimums,
   required components). Never-list items name the specific slop
   patterns to avoid for this project (e.g. "never purple gradients",
   "never Inter font", "no 3D SaaS blobs/glass orbs"). Keep this list
   short and specific — vague guardrails ("make it look good") do not
   work as guardrails.

Write this four-part prompt once per surface and reuse it verbatim across
every variant generated in step 3, so variants differ in style
execution, not in what was asked for.

## 3. Wide-net-then-narrow build sequence (`implementation` step)

Do not generate one version, react to it, and iterate serially — that is
the "prompt-and-pray" failure mode this whole doc exists to avoid.
Instead, widen first, then narrow, comparing side-by-side rather than
one-shot-then-tweak:

1. Generate **~5 versions in 5 visually distinct styles**, all from the
   same four-part prompt template (step 2) but with the aesthetic/family
   slot varied across the 5 style lanes.
2. Lay all 5 out **on one screen/canvas** for direct side-by-side
   comparison — never review generations one at a time in sequence,
   since that loses the comparative signal.
3. **Pick 1** overall direction.
4. From the picked direction, generate **3 body/layout variants**.
5. **Pick 1** body variant.
6. **Tweak** the picked combination (spacing, copy, minor color/type
   adjustments) to finish.

The funnel shape (5 → 1 → 3 → 1 → tweak) is the point: breadth before
narrowing avoids anchoring on the first output, and side-by-side
comparison surfaces differences a serial review would miss.

## 4. Assets-last ordering (`assets` / `motion` steps)

Sequence the remaining polish work in this order, deliberately deferring
typography and motion until the visual anchor is locked:

1. **Hero image first.** Generate several hero-image candidates, pick
   the strongest, then generate color variants of the winner (same
   composition, different palette) and pick the final color treatment.
2. **Then fine typography** — type scale, pairing, weight, tracking —
   once the hero anchors the palette and mood so type choices react to a
   settled visual, not a moving target.
3. **Then transitions / motion** — page/section transitions, animation
   "weight" (how heavy or snappy motion feels), and reveal distance (how
   far an element travels into view on scroll/entry).

Doing typography or motion before the hero image is settled means
redoing that work once the hero forces a palette or mood change — hence
"assets-last" for the fine-detail passes, "hero-first" for the asset
pass itself.

## 5. Live tweaks-bar pattern (`polish` step)

Wire a lightweight tweak bar into the dev server for the surface under
design, exposing the highest-friction visual variables as live controls
instead of round-tripping through prompts for each small change:

- Font family and font size (type scale multiplier).
- Accent color(s) (swatch picker or hex input).
- Motion "weight" (a slider from subtle to pronounced).
- Reveal distance (how far elements travel on scroll-in).

The bar should apply changes live (CSS custom properties / a theme
context are enough — no build step) so a designer can drag a slider and
see the result immediately, rather than editing a prompt, regenerating,
and waiting. Any lightweight dev-only overlay component satisfies this
pattern; it does not need to be a specific packaged tool.

## 6. Anti-slop review lens (`testing` / `polish` steps)

Before calling a surface done, run it through a 7-axis checklist. Each
axis names a category of "AI slop" tell to check for and correct:

1. **Typography** — generic/default font pairing, no type-scale
   discipline, no clear hierarchy.
2. **Color** — the well-known slop palettes (e.g. purple-to-blue
   gradients, default framework blues) with no relation to brand or
   content.
3. **Spatial** — uniform padding everywhere, no rhythm or intentional
   density variation, centered-everything layouts.
4. **Responsiveness** — desktop-only thinking that breaks or looks
   generic at mobile/tablet widths.
5. **Interaction** — hover/focus/active states that are default browser
   behavior or absent, no affordance for what's clickable.
6. **Motion** — motion that is either absent (static, lifeless) or
   uniform/default (every element fades-and-slides identically,
   ignoring the "weight"/reveal-distance choices from step 4/5).
7. **UX writing** — generic placeholder-sounding copy ("Welcome to our
   platform", "Get Started Today") instead of copy specific to the
   intent captured in step 2.

Walk all 7 axes for every surface at the `testing`/`polish` pipeline
step. This list is intentionally short and process-oriented; a fuller,
more exhaustive catalogue of specific slop patterns (named gradients,
named component shapes, etc.) exists in upstream anti-slop tooling and is
out of scope for this internal doc — cross-reference such a catalogue
from the tracked external-tool ticket instead of duplicating it here.

## Cross-reference

This doc captures the vendor-neutral **process**. The specific external
tools that can implement pieces of it (a taste/reference-curation skill,
a reference-image MCP, an automated component generator, a packaged
tweak-bar dev harness) are a separate, human-gated adoption decision —
see **TASK-178** for that tracked evaluation. Nothing in this doc should
be read as depending on, or advertising, any of those tools.
