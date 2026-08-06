---
description: Update the hivemind plugin to the latest version — run this whenever you want to pull in newly-shipped commands, agents, or workflow scripts.
---

# /hivemind:update

Update the hivemind plugin to the latest version and surface the result. Use this command whenever a new release has shipped and you want to pull in the latest commands, agents, workflow scripts, or other improvements.

## Step 1 — Run the plugin update

Run the following command via the Bash tool:

```bash
claude plugin update hivemind
```

Wait for it to complete, then relay the full output to the user exactly as printed. A successful update prints a confirmation line such as:

```
✔ Successfully updated hivemind to <version>
```

If the plugin is already at the latest version, the CLI will say so — relay that message too so the user knows nothing changed.

## Step 2 — Retrofit any newly-shipped workflow files

After the plugin updates, run `/hivemind:apply-workflows` to bring any new workflow scripts (such as `deep-review.js` or `deep-research.js`) into your project's `.claude/workflows/` directory.

> **Why apply-workflows?** The plugin update refreshes the installed plugin code, but it does not automatically copy new files into your project. `/hivemind:apply-workflows` detects which workflow files are missing from your project and adds only those — it never overwrites anything you already have.

## Step 3 — Context-monitor paths self-heal; you don't need to do anything for them either

Your project's `.claude/settings.json` carries an **absolute, version-pinned path** into the plugin
cache for the statusline and context-monitor hook commands — baked in at init time because
`${CLAUDE_PLUGIN_ROOT}` is *not* expanded inside a project's own `settings.json` (only inside the
plugin's own `hooks/hooks.json`). After `/plugin update`, the old version's cache directory is
removed, so that baked path points at nothing.

This is **not** something you need to repair by hand. `context-monitor/repin.mjs` ships as a
plugin-level `SessionStart` hook — running from the plugin's own `hooks/hooks.json`, where
`${CLAUDE_PLUGIN_ROOT}` *is* expanded — and re-points any stale context-monitor paths automatically
the moment your **next session starts** (idempotent, heal-only: it only fixes hivemind's own
entries, never touches anything else in `settings.json`). Watch for a short transcript note at that
session's start, e.g. `hivemind: repaired 3 stale context-monitor paths in .claude/settings.json...`
— that confirms it ran. No note means nothing was stale.

> **Timing note:** that note lands *during* `SessionStart`, after Claude Code has already read
> `settings.json` for that session — so the statusline itself realistically catches up starting the
> session *after* the one where the note appears. Seeing the note but the statusline bar still
> looking wrong in the *same* session is expected, not a second failure; give it one more session
> start (or use the manual command below to force it before continuing).

If you want the repair to happen immediately, without waiting for your next session: **note that
`${CLAUDE_PLUGIN_ROOT}` is only set when Claude Code itself spawns a plugin hook — it is not set in
your own shell**, so `node ${CLAUDE_PLUGIN_ROOT}/context-monitor/repin.mjs` typed directly will fail
with a "Cannot find module" error. Resolve the real install path first, then run the script from
there (run both from your project directory; this is plain `node`, no bash-specific syntax, so it
works the same from PowerShell or cmd — just substitute the value from step 1 into step 2):

```bash
# 1. Find your current install path (installPath for hivemind@hivemind-marketplace):
node -e "const p=require('os').homedir()+'/.claude/plugins/installed_plugins.json';const d=JSON.parse(require('fs').readFileSync(p,'utf8'));console.log((d.plugins['hivemind@hivemind-marketplace']||[])[0]?.installPath)"

# 2. Run repin.mjs from that path (replace <installPath> with step 1's output):
node "<installPath>/context-monitor/repin.mjs"
```

**You do not need to re-run `/hivemind:init-project`** to fix any of this. That command bootstraps
a brand-new project (`PROJECT.md`, seeded backlog, session bundle) — for an already-initialized
project, `apply-workflows` (Step 2) is the right follow-up for new workflow *files*, and the
automatic re-pin above (or the manual command) is what handles stale settings.json paths;
`init-project` would do far more than either of those need.

## Notes

- The update command requires that you have previously installed the plugin (`claude plugin install hivemind@hivemind-marketplace`). If it is not installed, install it first.
- Running this command does not affect your project files (`PROJECT.md`, `tasks/`, `state/`) — it only updates the plugin's own code in the plugin cache.
- If the update fails (e.g. no network access or the marketplace is unreachable), relay the error message and suggest the user check their connection and try again.
