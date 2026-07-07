// tests/bundle-compaction-doc-locks.spec.js
// TASK-103 AC5 — RESUME-FIRST documentation (SKILL.md both copies +
// state/README.md) must reflect the compacted layout and the rotation
// lifecycle. Mirrors the string-presence convention in tests/docs.spec.js
// and tests/agility-doc-locks.spec.js: these assertions prove the prose was
// updated, not that it is exhaustively correct.
//
// Parity note: only the plugin-root copy (skills/orchestrator-routing/SKILL.md)
// is read for content assertions here; tests/orchestrator-routing-skill.spec.js
// already fails on any byte divergence from .claude/skills/, so re-asserting
// content against both copies would be redundant (same convention documented
// in tests/agility-doc-locks.spec.js).
//
// Pure string reads of committed files — no disk I/O beyond that. Fast tier
// (tests/*.spec.js).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';

const SKILL_PATH = join(REPO_ROOT, 'skills', 'orchestrator-routing', 'SKILL.md');
const README_PATH = join(REPO_ROOT, 'state', 'README.md');

function load(path) {
  return readFileSync(path, 'utf8');
}

describe('AC5 — orchestrator-routing SKILL.md documents the rotation lifecycle', () => {
  it('documents the 15-entry cap and the typed E_BUNDLE_INVALID enforcement', () => {
    const text = load(SKILL_PATH);
    expect(text).toMatch(/capped at 15 entries each/);
    expect(text).toMatch(/E_BUNDLE_INVALID/);
  });

  it('documents the compact-bundle mechanism and its no-data-loss archive', () => {
    const text = load(SKILL_PATH);
    expect(text).toMatch(/compact-bundle/);
    expect(text).toMatch(/archive\.jsonl/);
    expect(text).toMatch(/idempotent/);
  });

  it('documents the R29 graph-ref addressability fallback (bundle-dir + archive)', () => {
    const text = load(SKILL_PATH);
    expect(text).toMatch(/knowledge-graph decision node/);
    expect(text).toMatch(/#<at>/);
  });
});

describe('AC5 — state/README.md documents compaction (bundle hygiene)', () => {
  it('lists archive.jsonl as an optional bundle-dir file', () => {
    const text = load(README_PATH);
    expect(text).toMatch(/archive\.jsonl/);
  });

  it('documents the schema maxItems caps and the validate-before-write guard', () => {
    const text = load(README_PATH);
    expect(text).toMatch(/maxItems/);
    expect(text).toMatch(/E_BUNDLE_INVALID/);
  });

  it('documents compactBundleSession / compact-bundle and the archive being append-only', () => {
    const text = load(README_PATH);
    expect(text).toMatch(/compactBundleSession/);
    expect(text).toMatch(/append-only/);
  });
});
