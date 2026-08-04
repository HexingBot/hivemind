---
description: Install the design-power addon pack's skills into the current project — checks the PROJECT.md design profile, resolves the desired resource set, previews the plan, applies it, reports what was and was NOT installed (Wave-2 MCP/plugin resources are left for the human), and offers to run the tracked external design tools (Impeccable, Taste Skill, Higgsfield, 21st.dev Magic) from upstream on explicit, per-tool human consent.
---

# /hivemind:design-pack

Push-button install for the **design-power** addon pack (`packs/design-power/descriptor.json`).
This command drives the shipped, deterministic reconciler CLI — it never invents install logic of
its own. Today the reconciler is **skills-only** (Wave 1): it can materialize the pack's skill
resources, but MCP servers and marketplace plugins (Wave 2) still need a human to run their own
install command. Be upfront about that split at every step. Separately, Step 6 below offers to run
a small set of tracked external design tools straight from this command, but only ever on an
explicit, per-tool human "yes" — see Step 6 for the full consent protocol.

## Step 1 — Check the project's design profile

Read `PROJECT.md` in the target project. The design-power pack only activates when the project's
intake answered the design-heavy gate question `yes` — that shows up as a `tier` and
`perfil_proyecto` frontmatter pair on `PROJECT.md`. If neither is present, tell the human this
project was never profiled as design-heavy (the pack will resolve to nothing) and ask whether they
want to re-run `/hivemind:init-project` to answer the design questions, or proceed anyway (a
non-design-heavy profile is a legitimate resolve — it just yields an empty desired set).

## Step 2 — Resolve the desired resource set (read-only)

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/pack-ctl.cjs resolve --repo-root <project-root>
```

Prints `{ desired: [...] }` — every pack resource this project's scored profile activates, before
any diff against what is actually on disk. Zero writes.

## Step 3 — Preview the plan (read-only)

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/pack-ctl.cjs reconcile-plan --repo-root <project-root>
```

Prints `{ plan: { install, remove, replace, report } }` — `install`/`remove`/`replace` cover only
`kind: "skill"` resources (Wave-1 scope); `report` lists every non-skill (`mcp`/`plugin`) desired
resource that is out of scope for this planner, each carrying `{ id, reason, blocking }` (`blocking`
is `true` only when the descriptor marks that resource `required: "hard"`). Show this plan to the
human before applying — it is the same plan `reconcile-apply` will act on.

## Step 4 — Apply the plan

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/pack-ctl.cjs reconcile-apply --repo-root <project-root>
```

On success, prints `{ ok: true, planned_install_count, installed_count, planned_replace_count,
replaced_count, source_root, plan, packs: [{ id, owner, aborted, installed, replaced, report }] }`.
On failure it ALSO prints two more top-level fields, `code` and `message` — see the `ok: false`
bullet below. Idempotent: running it again with nothing changed reproduces the same `plan` with
empty `install`/`remove`/`replace`.

- `plan` is the same plan Step 3 previewed, recomputed just before applying — that recomputation is
  the idempotency proof described above.
- `packs[]` is per-pack: `installed` is the list of skill resource ids THAT pack actually
  materialized under `.claude/skills/`; `replaced` (TASK-199) is the list of skill resource ids THAT
  pack actually retired-and-rematerialized via the dual-copy-precedence path below (a subset of the
  plan's `replace` bucket — a deliberately-kept-as-is or soft-failed replace is never in this list);
  `aborted` is `true` when that pack hit a `required: "hard"` resource it could not materialize and
  stopped short; `report` is that pack's own per-pack report, with entries of the form
  `skill:<resource-id>` (distinct from the top-level `plan.report`, which only ever holds
  `mcp`/`plugin` entries).
- **Dual-copy precedence (TASK-182):** a skill that is both a project-scope resource (`.claude/skills/<id>/`,
  reachable as `/<id>`) AND shipped directly with the plugin (`${CLAUDE_PLUGIN_ROOT}/skills/<id>/`,
  reachable as `/hivemind:<id>`) can diverge if the project-scope copy goes stale relative to a newer
  plugin release. **The plugin copy wins whenever the comparison is decidable and equal-or-newer** —
  see `docs/design/addon-packs.md` §2.4 for the full decision record (including the residual: a
  non-semver/git-sha pin divergence is `'undecidable'` and is always kept, never silently retired).
  When this happens, `packs[].report` carries an entry with `retired: true` and `executed: true`,
  naming the old and new pin in `reason` — surface this to the human exactly like any other report
  entry; it means the project-scope alias for that skill now serves the plugin's content, not a
  stale local one. **To tell which copy is currently active and at what pin:** read the resource's
  own `.claude/skills/<resource-id>/SKILL.md` provenance block (`- pin: <value>`, under "## Sources &
  provenance (hivemind)") for what's actually live, and compare it against the SAME resource's `pin`
  in `packs/design-power/descriptor.json` / `packs/watch/descriptor.json` (whichever pack owns it)
  for what the plugin currently ships; `source_root` (below) names the directory the last
  `reconcile-apply` actually vendored content from.
- `planned_install_count` (= `plan.install.length`) and `installed_count` (= the sum of every pack's
  `installed.length`) are the run-level triage numbers — read these FIRST, before looking at any
  individual pack's `report`. `source_root` is the directory the reconciler vendored owned skill
  copies from (post-TASK-181, normally the plugin's own `assimilated-skills/`, or the project's own
  if it has one); `null` when no owned-source root could be resolved at all.
- **`planned_replace_count`/`replaced_count` (TASK-199)** are the replace-bucket analogue, read
  alongside the install counts, not instead of them. `planned_replace_count` counts only the replace
  ops the apply-time dual-copy-precedence gate will actually ATTEMPT (equal-or-newer, decidable) — a
  replace the gate deliberately keeps as-is (project-scope pin ahead, or an undecidable divergence
  such as a non-semver/git-sha pin — the normal case for every built-in pack today, see the
  dual-copy-precedence bullet above) is never counted here, because it is a designed no-op, not a
  failure. `replaced_count` (= the sum of every pack's `replaced.length`) is how many of those
  attempted replaces actually landed. A **successful** replace is visible here even when
  `installed`/`installed_count` show zero activity — do not read an all-zero install count as "the
  run did nothing" without also checking `replaced_count`.
- **`ok: true` is the ONLY success path, and it means EVERY planned install AND EVERY planned
  (attempted) replace actually materialized** (`installed_count === planned_install_count` AND
  `replaced_count === planned_replace_count`) **and no pack aborted** (`packs.every(p =>
  !p.aborted)`). It also covers the legitimate no-op (`planned_install_count === 0` AND
  `planned_replace_count === 0` — nothing was ever desired or needed replacing).
- **`ok: false` covers three distinct failure kinds**, now evaluated over install+replace combined —
  total (something was planned across either bucket and NOTHING across either bucket landed), partial
  (something landed but less than what was planned, in either bucket), and aborted (at least one pack
  hard-aborted, checked first and taking precedence over the total/partial split). On ANY of the
  three, the process also prints two extra top-level fields: `code` — one of
  `E_PACK_APPLY_TOTAL_FAILURE`, `E_PACK_APPLY_PARTIAL_FAILURE`, or `E_PACK_APPLY_ABORTED_FAILURE` —
  and `message`, a human-readable summary of the installed/planned AND replaced/planned counts (and
  whether a hard-required resource aborted the run). The CLI process itself **exits 1** on any
  `ok: false` result (`message` is also written to stderr) — a shell caller sees a non-zero exit
  exactly when the JSON says `ok: false`, never a silent 0. Treat `ok: false` as a hard stop
  regardless of which of the three kinds it is: show the human the full `packs[].report` (and
  `code`/`message`) before doing anything else; do not proceed to Step 5's normal reporting.
- A skill can be in the plan's top-level `install` bucket (Step 3) and still fail to materialize here
  for a documented, expected reason (no owned copy to vendor from) — that shows up as a
  `skill:<resource-id>` entry in `packs[].report`, and Step 5 turns every such entry into an adoption
  instruction. **Triage with `ok`/`installed_count` first, not with the presence of a `skill:` report
  entry.** Use them to tell "nothing needed installing" (`planned_install_count === 0`, `ok: true`)
  apart from "something failed to install" (`ok: false`); only once you've done that does a matching
  `skill:` report entry explain WHICH skill and why. Do not read a short `installed` as automatically
  expected merely because *some* `skill:` report entry exists elsewhere in `packs[].report` — a
  materialize miss is not guaranteed to always carry a matching report entry, so its absence does not
  itself prove success.

## Step 5 — Report the split, honestly

Present **three** lists to the human, never conflating them:

1. **Skills materialized** — the `installed` ids from Step 4's output.
2. **Skills that still need adoption** — every entry in `packs[].report` (Step 4's per-pack report,
   not the top-level `plan.report`) whose `id` starts with `skill:`. This is the runtime signal that
   a desired skill could not be materialized because no owned copy exists yet — key on this signal
   itself, not on the human-readable `reason` string, which may change. For each one:
   - Strip the `skill:` prefix to get the resource id, and look up that id in
     `packs/design-power/descriptor.json`'s `resources[]` to read its `origin` and `pin`.
   - Instruct the human to run the human-gated **`assimilate-current-project`** skill to vendor it,
     giving it the resource's `origin` and `pin`, e.g. (illustrative shape only — post-TASK-181
     `ui-ux-pro-max` normally installs automatically from the plugin's owned copy per Step 4/5's
     fresh-project note below, so this exact resource id would only ever land here if that owned copy
     were somehow missing; substitute whichever resource id actually appears in `packs[].report`):

     ```
     ui-ux-pro-max (skill, required: soft) — not installed; no owned copy found.
     Run assimilate-current-project to vendor it:
       origin: github.com/nextlevelbuilder/ui-ux-pro-max-skill
       pin:    12b486b22e67f5d887962ef8351c1ac863bfaeb9
     Then re-run /hivemind:design-pack to materialize it.
     ```
   - Never shortcut assimilation yourself — do not copy the skill in manually or skip the
     `assimilate-current-project` protocol to save a step.
3. **Wave-2 resources NOT installed** — every `mcp`/`plugin` entry in the **top-level** `plan.report`.
   For each one, look up its `install` command in `packs/design-power/descriptor.json`'s
   `resources[]` (matched by `id`) and give the human the exact command to run themselves, e.g.:

   ```
   shadcn/ui (mcp, required: soft) — not installed by this reconciler.
   Run yourself: claude mcp add shadcn -- npx shadcn@4.13.0 mcp
   ```

   Do this for every report entry, not just the `blocking: true` ones — a `soft` gap is still a
   gap the human should know about, just not one that blocked the run.

On a **fresh project** where nothing has been assimilated yet, the built-in pack skills install
automatically from the plugin's own owned copies (post-TASK-181) — do NOT expect a bare `installed:
[]` as the normal first run. Expect list 1 to include `watch` unconditionally (it is `activate_when:
"always"`) plus `ui-ux-pro-max` whenever the resolved profile desires it (`tier != LIGERO`); neither
needs `assimilate-current-project` on a fresh project that has the shipped plugin, because the
plugin already carries their owned copies. List 2 (skills that still need adoption) is expected to be
non-empty only for a genuinely third-party resource that has no owned copy anywhere in the plugin or
the project — that is the exceptional case now, not the default.

If list 2 is empty and `installed` is also empty, check Step 4's `ok`/`planned_install_count` before
concluding the profile genuinely desired no skills: a true no-op has `planned_install_count === 0`
AND `ok: true`. A short or empty `installed` alongside a non-empty `planned_install_count` — with
nothing in list 2 to explain it — is the signal Step 4 describes as a possible total, partial, or
aborted failure (`ok: false`, with `code`/`message` alongside); it can also be a materialize miss with
no corresponding `skill:` report entry to explain it at all (a known limitation — do not treat that
silence as proof of success either).

## Step 6 — Offer the tracked external design tools (upstream, consented)

This step is **independent of Steps 2-4** and additive to Step 5's three lists — do not skip it and
do not let it replace anything above. `packs/design-power/descriptor.json` also tracks four external
design tools that are deliberately **inert in the reconciler** (TASK-178): their ids are absent from
`src/design-profile.js#resourceActivations` — a hardcoded map, **not** a descriptor key, so adding a
descriptor field would not gate them either — so `resolve` never desires them and `reconcile-plan`'s
`report` never lists them; they will not show up anywhere in Steps 2-5. Read them straight from the
descriptor file instead.

### 6a — Find the tracked resources (data-driven, re-derive every run)

Filter `packs/design-power/descriptor.json`'s `resources[]` for entries whose `activate_when` field
contains the substring `not gated by resourceActivations`. As of this writing that yields four
resources — `impeccable`, `taste-skill`, `higgsfield`, `21st-dev-magic` — but never hardcode that
list; re-derive it from the descriptor each time so a future tracked addition is picked up
automatically without a command change. (This substring coupling is locked by a regression test,
`tests/design-power-descriptor.spec.js`'s "AC6 — tracked-tool marker" describe block — if a future
descriptor reword changes the marker text, that spec fails loudly instead of silently emptying this
offer.)

### 6b — Classify each one from its existing `kind`/`install` fields (no descriptor schema change)

1. **`install` mentions vendoring** (contains the word "assimilate") → route to the human-gated
   `assimilate-current-project` skill exactly like Step 5 list 2. Never auto-run this class. (None of
   the four tracked resources match today — `ui-ux-pro-max` already routes this way via Step 5 list 2
   — but check this rule first so a future tracked entry can never silently fall through to the
   auto-offer below.)
2. **`kind: "plugin"`** — an installable skill/plugin (`impeccable`, `taste-skill`) → OFFER to run
   the upstream installer, per 6c.
3. **`kind: "mcp"`** needing auth or billing (`higgsfield`, `21st-dev-magic`) → OFFER to run the
   registration command, but disclose auth + billing before asking, per 6d.

**General rule (applies to 6c and 6d alike):** the offer-to-RUN only ever auto-runs a command this
orchestrator can actually execute via Bash (`npx ...`, `claude mcp add ...`). A descriptor `install`
value that is a **TUI-only** Claude Code slash command (anything starting with `/plugin ...`) cannot
be exec'd by this orchestrator at all — a consented "yes" against it would silently fail. For any
TUI-only `install`, either offer a shell-executable equivalent when one exists (preferred — see
Impeccable below), or walk the human through typing the TUI command themselves; never treat a
consented "yes" as a no-op.

### 6c — Offer: installable skills/plugins (Impeccable, Taste Skill)

For each, tell the human, before asking anything:
- The **exact command** to run.
- The **install scope**: GLOBAL — both Impeccable and Taste Skill install into `~/.claude`, affecting
  every project on this machine, not just this one.
- For **Impeccable** specifically: the descriptor's `install` field (`/plugin marketplace add
  pbakaus/impeccable`) is a **TUI-only** Claude Code slash command this orchestrator cannot exec via
  Bash. Prefer offering the shell-executable, upstream-tracking equivalent instead:
  ```
  npx impeccable install
  ```
  (updates later via `npx impeccable update`). Mention `/plugin marketplace add pbakaus/impeccable`
  as the TUI alternative the human can type themselves if they'd rather use that path. On a
  consented "yes" for Impeccable, run `npx impeccable install` — never silently fail a "yes" by
  attempting to exec the TUI-only form.
- For **Taste Skill** specifically, default the offered command to the focused single skill instead
  of the bare add:
  ```
  npx skills add https://github.com/Leonxlnx/taste-skill --skill design-taste-frontend
  ```
  Mention, as a secondary opt-in note, that the bare `npx skills add https://github.com/Leonxlnx/taste-skill`
  (no `--skill` flag) pulls the entire 13-skill collection — offer that only if the human asks for it.

Then ask an explicit yes/no **per tool**: "Install `<tool>` now? [y/N]". Wait for a real answer — do
not assume yes, and do not fold multiple tools into one combined confirmation. Only on an explicit
"yes" for that specific tool do you run the exact (shell-executable) command shown. On "no" or no
answer, skip it and record it as declined in your report to the human; a decline on one tool must
never skip the offer for the other.

### 6d — Offer: MCP tools needing auth/billing (Higgsfield, 21st.dev Magic)

For each, before asking for consent, disclose:
- The **exact command** to run, taken verbatim from the descriptor's `install` field.
- The **install scope** — `higgsfield` registers at `scope: user` (global, across every project on
  this machine); `21st-dev-magic` registers at `scope: project` (this repo's own MCP config).
- The **auth/billing** cost, verbatim:
  - **Higgsfield**: requires an OAuth login to higgsfield.ai **and paid credits** — this is not free.
  - **21st.dev Magic**: requires an API key from 21st.dev (`--api-key <key>`, supplied by the human);
    the free tier is 2 runs/day, anything beyond that needs a paid key.

Then ask the same explicit per-tool yes/no. On "yes", run the registration command as shown — never
silently substitute or fabricate a credential; if a key is required, ask the human to supply it, or
offer to let them run the command themselves instead of pasting a credential into this session. On
"no", skip it and record the decline.

### 6e — Security invariant (read before offering anything; mirrors the assimilation carve-out)

- Steps 6c/6d are the **only** way this command runs a third-party installer, and it is **never
  autonomous**: nothing here ever runs without a fresh, explicit, per-invocation, per-tool human
  "yes" that names exactly what is about to run.
- This offer is **never liftable by any `loop_auth` grant** — no standing authorization, trust
  preset, or unattended-loop mode ever converts a 6c/6d offer into an autonomous run. If this command
  runs from inside `/hivemind:loop`, still stop and ask; a loop-wide `loop_auth` grant never covers
  these installers.
- The human can decline any one tool without affecting the others — evaluate and offer all four
  independently, in any order.
- Never omit or soften install scope (global vs project) or auth/billing cost — state them before
  asking for consent, never after.

## Notes

- This command never assimilates a third-party skill on its own initiative — a resource whose
  `install` says "vendor via assimilate" still needs the full human-gated `assimilate-current-project`
  protocol (the shipped, consumer-project entry point — this project is never the hivemind framework
  repo itself) whenever no owned copy already exists to vendor from. `ui-ux-pro-max`'s `install` field
  still reads "vendor via assimilate (FP-5)", but post-TASK-181 the plugin ships an owned copy
  (`assimilated-skills/ui-ux-pro-max/`), so Step 4 now materializes it automatically on a fresh
  project without ever reaching this path — assimilate only becomes necessary if that owned copy is
  ever missing, or for a genuinely different third-party resource the plugin has not vendored. Point
  the human at `assimilate-current-project` only when Step 5 list 2 actually names the resource; do
  not preemptively suggest it for something that already installed.
- Step 6's tracked-tool offer is a separate mechanism from assimilation and from Wave-2 report
  printing: it runs an upstream installer directly, on consent, rather than vendoring a copy or
  merely printing a command for the human to run themselves. It never overlaps the two — a resource
  routes to at most one of assimilate / Step 5 print / Step 6 offer.
- `--repo-root` is required on every `pack-ctl` subcommand; resolve it the same way the rest of the
  framework does — `CLAUDE_PROJECT_DIR` if set, else the current working directory.
- See `skills/orchestrator-routing/SKILL.md`'s "Addon-pack + assimilate surface" section for how
  this command fits into the broader addon-pack story.
