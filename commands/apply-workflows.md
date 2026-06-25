---
description: Retrofit workflow files into an already-initialized project after a plugin update — adds any missing .claude/workflows/ files without touching PROJECT.md or existing workflows.
---

# /hivemind:apply-workflows

Retrofit workflow files from this plugin into the current project's `.claude/workflows/` directory. Use this command after updating the plugin to pick up newly-shipped workflow scripts (such as `deep-review.js` or `deep-research.js`) in a project that was initialized with an older version.

> **Distinction from init-project:** `/hivemind:init-project` bootstraps a fresh project (creates `PROJECT.md`, seeds the backlog, mints a session bundle); `/hivemind:apply-workflows` retrofits workflow files into an already-initialized project after plugin updates — it touches nothing except `.claude/workflows/`.

## Step 1 — Run the bundled init entry with --apply-workflows

Run the shipped, self-contained bundle via the Bash tool:

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/init.cjs --apply-workflows
```

- `${CLAUDE_PLUGIN_ROOT}` resolves to the plugin's own installed code.
- The bundle resolves the **target project directory** from `CLAUDE_PROJECT_DIR` (falling back to the current working directory), so all artifacts land in the **user's project**, never in the plugin cache.
- The flag bypasses the wizard entirely — no questions are asked, `PROJECT.md` is never read or written, and no session bundle is minted.
- Existing files in `.claude/workflows/` are **never overwritten** (never-overwrite contract preserved). Only missing files are added.

## Step 2 — Report the result

The bundle prints a one-line summary:

```
--apply-workflows: N file(s) added (deep-research.js); M file(s) already present and skipped (deep-review.js).
```

Relay that summary to the user. If `0 file(s) added`, let them know all workflow files are already present and nothing changed.

## Notes

- Safe to run on projects in any state (already-initialized, fresh clone, or uninitialized) — the flag always materializes workflows and exits.
- Cannot be combined with `--force` or `--answers-file`; mixing those flags exits with a parse error before any filesystem write.
