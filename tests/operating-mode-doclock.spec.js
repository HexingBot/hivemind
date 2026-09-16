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

  it('the corrected behavior is documented: getMode throws on corrupt state and this module does not catch it', () => {
    expect(source).toMatch(/getMode.*throw/is);
    expect(source.toLowerCase()).toContain('modestateerror');
  });
});
