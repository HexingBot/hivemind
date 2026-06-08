// tests/e2e-install.spec.js
// TASK-027 — Plugin chain P7 (AC1): clean-machine end-to-end install proof.
//
// AC1 is a MANUAL SENSOR, NOT vitest-automatable: it drives a LIVE `claude`
// agent loop AND mutates the real plugin config (`claude plugin marketplace add`
// / `install` write to the user's ~/.claude config). vitest cannot drive an
// interactive agent through tests-first→impl→review, so — exactly like the
// manual sensors in tests/init-command.spec.js (AC1/AC2 registration) and the
// TASK-020 §D.5 proof-of-load — this is authored as a documented `it.skip`. The
// reviewer/human executes the sequence by hand and records the observations.
//
// AUTHORIZED CONTEXT (TASK-027 orchestrator comment 2026-05-29T05:15): AC1's
// E2E drives a trivial task through the FILE-based task store, so the MCP server
// (P6/TASK-026) is NOT on the critical path; doing P7 before P6 is authorized.
//
// =====================================================================
// MANUAL E2E SEQUENCE (run on a clean machine / fresh shell; PowerShell)
// =====================================================================
//
// Let REPO = C:\Users\srpar\OneDrive\Documents\agentic-framework  (this repo,
// which IS the marketplace — Q5 resolved).
//
// 1. ADD THE MARKETPLACE (this repo, by absolute path or its git URL):
//      claude plugin marketplace add <REPO-abs-path-or-git-url>
//    EXPECT: "✔ Successfully added marketplace agentic-framework-marketplace".
//
// 2. INSTALL THE PLUGIN:
//      claude plugin install agentic-framework@agentic-framework-marketplace
//    EXPECT: "✔ Successfully installed agentic-framework".
//
// 3. CONFIRM THE COMPONENT INVENTORY (deterministic, non-interactive sensor):
//      claude plugin details agentic-framework
//    EXPECT in the inventory:
//      • the init-project command (per TASK-020 §D.5 it may surface under the
//        "Skills" bucket rather than a separate "Commands" bucket — that is the
//        documented cosmetic nuance; what matters is it REGISTERS).
//      • the orchestrator-routing backstop skill.
//      • the four agents (orchestrator / developer / reviewer / researcher)
//        under the `agentic-framework` namespace.
//      • version 0.1.0 (the explicit semver pinned in plugin.json — AC3).
//
// 4. BOOTSTRAP A FRESH PROJECT. In a brand-new EMPTY temp dir (the user's
//    "project"), launch `claude` and run:
//      /agentic-framework:init-project
//    EXPECT, ALL written into the PROJECT dir (NOT the plugin cache):
//      • PROJECT.md at the project root.
//      • a seeded starter backlog under tasks/ (TASK-NNN.json with `seed` label).
//      • a session bundle: state/session.json pointer + state/sessions/<id>/.
//      • .claude/agents/project-context.md.
//      • the project's CLAUDE.md carries the
//        `<!-- BEGIN agentic-framework routing -->` … `<!-- END ... -->` block
//        (written fresh if no CLAUDE.md existed; merged in if one did).
//    EXPECT NOT: the plugin cache dir (~/.claude/plugins/...) is NOT mutated —
//      no PROJECT.md / tasks / state written there.
//
// 5. DRIVE ONE TRIVIAL TASK END TO END using the INSTALLED plugin's agents.
//    In the same `claude` chat, ask the orchestrator to pick one trivial seeded
//    ticket and run the full loop:
//      tests-first (developer) → implementation (developer) → review (reviewer)
//      → transition the ticket to `done`.
//    EXPECT: the orchestrator spawns the installed `agentic-framework:developer`
//      and `agentic-framework:reviewer` subagents; a test commit precedes the
//      impl commit; the reviewer runs read-only; the ticket's status reaches
//      `done` with linked_commits populated — proving the agent team activates
//      from the INSTALLED plugin, not from this dev repo's local .claude/.
//
// 6. CLEAN UP (leave the machine pristine):
//      claude plugin uninstall agentic-framework
//      claude plugin marketplace remove agentic-framework-marketplace
//    EXPECT: both "✔ Successfully ..."; `claude plugin list` /
//      `claude plugin marketplace list` show zero agentic-framework residue.
//
// RECORD the observed output of steps 1–6 (especially the step-3 inventory and
// the step-4 project-dir artifact list) in the ticket comment as AC1's proof.

import { describe, it } from 'vitest';

describe('AC1 — clean-machine plugin install E2E (MANUAL sensor)', () => {
  it.skip('install_init_drive_uninstall_see_comment_above', () => {
    // Deliberately NOT automated — see the manual E2E sequence documented above.
    // The reviewer/human executes it on a clean machine and pastes the observed
    // `plugin details` inventory + the project-dir artifact list into the ticket.
  });
});
