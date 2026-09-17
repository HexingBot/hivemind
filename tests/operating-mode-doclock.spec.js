// tests/operating-mode-doclock.spec.js
// TASK-236 CU8 (WG-H-007) — a plain fs-read doc-content check, fast tier (no
// disk I/O), mirroring this repo's existing doc-lock pattern (e.g.
// tests/bundle-compaction-doc-locks.spec.js).
//
// Harm prevented: src/close-guard.js's own doc comments used to describe
// getMode's blanket "default to 'harness' on any missing/corrupt pointer or
// bundle" as if it were benign — the exact false framing named in the
// ticket (src/close-guard.js:518, echoed at :15/:474 before the fix). A
// reader trusting that comment would believe a corrupted state file safely
// falls back to harness, when in fact (pre-fix) it silently disabled the
// loop-mode close guard. This spec pins that the stale claim is gone and a
// corrected one, naming the actual post-fix behavior (getMode throws on
// corrupt state; this guard does not catch it), is in its place.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __thisDir = dirname(fileURLToPath(import.meta.url));
const CLOSE_GUARD_PATH = join(__thisDir, '..', 'src', 'close-guard.js');

describe('TASK-236 CU8 — close-guard.js no longer claims the harness default is benign on any error', () => {
  const source = readFileSync(CLOSE_GUARD_PATH, 'utf8');

  it('the retired claim ("already defaults to \'harness\' on any missing/corrupt pointer or bundle") is gone', () => {
    expect(source).not.toContain("already defaults to 'harness' on any missing/corrupt pointer or bundle");
  });

  // TASK-236 wargaming fix-round WG-3 (2026-09-17) — src/mcp-server.js and
  // src/task-board.js both used to carry "(getMode defaults to 'harness', a
  // no-op), so this is safe" as their justification for composing
  // loopModeCloseGuard unconditionally — stale in the milder direction once
  // getMode could throw on corrupt state. Harm prevented: a reader trusting
  // the stale comment would believe corrupt state is silently absorbed as a
  // no-op, when the real (still-safe) reason is that corrupt state now
  // aborts the transition instead. Locks the retired phrasing's absence in
  // both call sites so a future edit cannot silently reintroduce it.
  it('the stale "getMode defaults to \'harness\', a no-op, so this is safe" framing is gone from mcp-server.js and task-board.js', () => {
    const mcpServerSource = readFileSync(join(__thisDir, '..', 'src', 'mcp-server.js'), 'utf8');
    const taskBoardSource = readFileSync(join(__thisDir, '..', 'src', 'task-board.js'), 'utf8');
    expect(mcpServerSource).not.toContain("getMode defaults to 'harness', a no-op");
    expect(taskBoardSource).not.toContain("defaults to 'harness', a no-op");
  });

  // TASK-236 wargaming fix-round WG-3 — src/operating-mode.js's own setMode
  // comment used to claim "getMode above is deliberately NOT migrated — it
  // already swallows every error and defaults to 'harness'", 30 lines below
  // getMode's OWN corrected doc comment stating the opposite — a
  // self-contradiction within one file. Harm prevented: a reader landing on
  // the setMode comment first would believe getMode still swallows every
  // error, the exact pre-fix behavior this whole ticket removed.
  it('the stale "getMode above is deliberately NOT migrated — it already swallows every error" claim is gone from operating-mode.js', () => {
    const operatingModeSource = readFileSync(join(__thisDir, '..', 'src', 'operating-mode.js'), 'utf8');
    expect(operatingModeSource).not.toContain('it already swallows every error and');
  });

  it('the corrected behavior is documented: getMode throws a named ModeStateError, stated near its own mention', () => {
    // TASK-236 LOW-2 (review 2026-09-17) — the prior /getMode.*throw/is was
    // near-vacuous: with the /s (dotAll) flag it matches "getMode" ANYWHERE
    // in the file followed by "throw" ANYWHERE later, which a file full of
    // unrelated throw statements (LoopCloseGuardError, UatDelegationGuardError,
    // UatCommentGuardError) satisfies regardless of whether getMode's own
    // corrected behavior was ever documented — it would have passed
    // PRE-fix too. This bounds "throw" and "ModeStateError" to a 200-char
    // window after "getMode" so the match can only succeed when the source
    // actually states, close to a mention of getMode, that it throws a
    // ModeStateError — proved red against the pre-fix source (see the LOW-2
    // hand-off note: reconstructed via `git show <fix-sha>~1:src/close-guard.js`
    // into a temp file, never checked out into the working tree).
    expect(source).toMatch(/getMode[\s\S]{0,200}?throws?[\s\S]{0,200}?ModeStateError/i);
  });
});
