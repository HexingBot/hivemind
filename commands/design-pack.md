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

Prints `{ plan, packs: [{ id, owner, aborted, installed, report }] }` — `installed` is the list of
skill resource ids actually materialized under `.claude/skills/`. Idempotent: running it again with
nothing changed reproduces the same plan with empty `install`/`remove`/`replace`.

A skill can be in the plan's top-level `install` bucket (Step 3) and still fail to materialize here
— e.g. it has no owned copy the reconciler can vendor from. When that happens the CLI does not
crash; it records the miss as a **per-pack** report entry, `packs[].report`, with an id of the form
`skill:<resource-id>` (distinct from the top-level `plan.report`, which only ever holds `mcp`/
`plugin` entries). Step 5 turns every such entry into an adoption instruction — treat `installed`
being short of the desired skill set as expected, not a bug, whenever a matching `skill:` entry
exists in `packs[].report`.

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
     giving it the resource's `origin` and `pin`, e.g.:

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

On a **fresh project** where nothing has been assimilated yet, the expected first run of this
command is `installed: []` with `ui-ux-pro-max` appearing under "skills that still need adoption"
and its assimilate instruction shown — never a bare "nothing installed" with no next step. If list 2
is empty and `installed` is also empty, that means the profile genuinely desired no skills (e.g. a
non-design-heavy resolve), not that something silently failed.

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
  `install` says "vendor via assimilate" (e.g. `ui-ux-pro-max`) still needs the full human-gated
  `assimilate-current-project` protocol (the shipped, consumer-project entry point — this project
  is never the hivemind framework repo itself); point the human at that skill rather than trying to
  shortcut it here.
- Step 6's tracked-tool offer is a separate mechanism from assimilation and from Wave-2 report
  printing: it runs an upstream installer directly, on consent, rather than vendoring a copy or
  merely printing a command for the human to run themselves. It never overlaps the two — a resource
  routes to at most one of assimilate / Step 5 print / Step 6 offer.
- `--repo-root` is required on every `pack-ctl` subcommand; resolve it the same way the rest of the
  framework does — `CLAUDE_PROJECT_DIR` if set, else the current working directory.
- See `skills/orchestrator-routing/SKILL.md`'s "Addon-pack + assimilate surface" section for how
  this command fits into the broader addon-pack story.
