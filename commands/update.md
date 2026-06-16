---
description: Update the agentic-framework plugin to the latest version — run this whenever you want to pull in newly-shipped commands, agents, or workflow scripts.
---

# /agentic-framework:update

Update the agentic-framework plugin to the latest version and surface the result. Use this command whenever a new release has shipped and you want to pull in the latest commands, agents, workflow scripts, or other improvements.

## Step 1 — Run the plugin update

Run the following command via the Bash tool:

```bash
claude plugin update agentic-framework
```

Wait for it to complete, then relay the full output to the user exactly as printed. A successful update prints a confirmation line such as:

```
✔ Successfully updated agentic-framework to <version>
```

If the plugin is already at the latest version, the CLI will say so — relay that message too so the user knows nothing changed.

## Step 2 — Retrofit any newly-shipped workflow files

After the plugin updates, run `/agentic-framework:apply-workflows` to bring any new workflow scripts (such as `deep-review.js` or `deep-research.js`) into your project's `.claude/workflows/` directory.

> **Why apply-workflows?** The plugin update refreshes the installed plugin code, but it does not automatically copy new files into your project. `/agentic-framework:apply-workflows` detects which workflow files are missing from your project and adds only those — it never overwrites anything you already have.

**You do not need to re-run `/agentic-framework:init-project`.** That command bootstraps a brand-new project; for an already-initialized project, `apply-workflows` is the right follow-up after an update.

## Notes

- The update command requires that you have previously installed the plugin (`claude plugin install agentic-framework@agentic-framework-marketplace`). If it is not installed, install it first.
- Running this command does not affect your project files (`PROJECT.md`, `tasks/`, `state/`) — it only updates the plugin's own code in the plugin cache.
- If the update fails (e.g. no network access or the marketplace is unreachable), relay the error message and suggest the user check their connection and try again.
