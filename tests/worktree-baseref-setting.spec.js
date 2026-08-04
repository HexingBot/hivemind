// tests/worktree-baseref-setting.spec.js
// TASK-198 defect 1 sensor — a newly-created worktree must branch from local
// HEAD, not a stale `origin/<default-branch>`.
//
// TIER: fast (tests/*.spec.js) — a synchronous read of the repo's own
// committed .claude/settings.json, same precedent as
// tests/graph-freshness.spec.js reading tasks/*.json + graph.json.
//
// WHY this matters: this repo is worked local-first — `origin/main` regularly
// lags local `main` by many commits (63 commits / 5 days at the time this
// defect was found, TASK-198). Worktree isolation's default base ref is
// `origin/<default-branch>`, so an agent spawned into a worktree with no
// override lands on a checkout that predates the very ticket it was asked to
// follow up on (files it was told to edit do not exist yet; line-number
// citations resolve to unrelated code).
//
// THE FIX IS `.claude/settings.json`'s `worktree.baseRef: "head"` — a
// settings-file edit the Orchestrator/Developer is structurally blocked from
// making (the settings-file guard) and that guard is correct: this ticket
// does NOT attempt the edit. This spec is deliberately RED until a human (or
// an explicitly-authorized path) adds the setting — that red run IS the
// tests-first evidence for this ticket, not a broken gate. See the TASK-198
// hand-off for the captured verbatim red output.
//
// RED-GREEN EVIDENCE: captured in the TASK-198 developer hand-off (this spec
// failed with the message below at write time, before the human edit
// landed). Once `.claude/settings.json` carries `worktree.baseRef: "head"`,
// this spec goes green with no further code change.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';

function loadSettings() {
  const settingsPath = join(REPO_ROOT, '.claude', 'settings.json');
  return JSON.parse(readFileSync(settingsPath, 'utf8'));
}

describe('worktree base-ref sensor — worktrees must branch from local HEAD, not a stale remote ref', () => {
  it('dot_claude_settings_json_pins_worktree_baseRef_to_head', () => {
    const settings = loadSettings();

    expect(
      settings.worktree && settings.worktree.baseRef,
      'Expected `.claude/settings.json` to set `"worktree": { "baseRef": "head" }`. ' +
        'Without it, a newly-created worktree branches from `origin/<default-branch>` by ' +
        'default — which this repo (worked local-first) can leave many commits behind local ' +
        'HEAD, landing a spawned agent on a checkout that predates the very ticket it was ' +
        'asked to follow up on (TASK-198). This is a settings-file edit reserved for a human ' +
        '(or an explicitly-authorized path) — the Orchestrator/Developer is structurally ' +
        'blocked from making it. Add `"worktree": { "baseRef": "head" }` to ' +
        '`.claude/settings.json` to turn this sensor green.',
    ).toBe('head');
  });
});
