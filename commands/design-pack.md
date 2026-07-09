---
description: Install the design-power addon pack's skills into the current project — checks the PROJECT.md design profile, resolves the desired resource set, previews the plan, applies it, and reports what was and was NOT installed (Wave-2 MCP/plugin resources are left for the human).
---

# /hivemind:design-pack

Push-button install for the **design-power** addon pack (`packs/design-power/descriptor.json`).
This command drives the shipped, deterministic reconciler CLI — it never invents install logic of
its own. Today the reconciler is **skills-only** (Wave 1): it can materialize the pack's skill
resources, but MCP servers and marketplace plugins (Wave 2) still need a human to run their own
install command. Be upfront about that split at every step.

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

## Step 5 — Report the split, honestly

Present two lists to the human, never conflating them:

1. **Skills materialized** — the `installed` ids from Step 4's output.
2. **Wave-2 resources NOT installed** — every `mcp`/`plugin` entry in the plan's `report`. For
   each one, look up its `install` command in `packs/design-power/descriptor.json`'s `resources[]`
   (matched by `id`) and give the human the exact command to run themselves, e.g.:

   ```
   shadcn/ui (mcp, required: soft) — not installed by this reconciler.
   Run yourself: claude mcp add shadcn -- npx shadcn@4.13.0 mcp
   ```

   Do this for every report entry, not just the `blocking: true` ones — a `soft` gap is still a
   gap the human should know about, just not one that blocked the run.

## Notes

- This command never assimilates a third-party skill on its own initiative — a resource whose
  `install` says "vendor via assimilate" (e.g. `ui-ux-pro-max`) still needs the full human-gated
  `hivemind-assimilate-skill` protocol; point the human at that skill rather than trying to
  shortcut it here.
- `--repo-root` is required on every `pack-ctl` subcommand; resolve it the same way the rest of the
  framework does — `CLAUDE_PROJECT_DIR` if set, else the current working directory.
- See `skills/orchestrator-routing/SKILL.md`'s "Addon-pack + assimilate surface" section for how
  this command fits into the broader addon-pack story.
