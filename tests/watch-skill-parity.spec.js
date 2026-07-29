// tests/watch-skill-parity.spec.js
// TASK-180 — the assimilated `watch` skill ships to consumers out of the box from
// plugin-root skills/watch/, alongside the owned copy at assimilated-skills/watch/
// (the supply-chain record of record) and the dogfood mirror at .claude/skills/watch/.
//
// Three copies means three chances to drift. The owned copy is the one the provenance
// block's source_integrity/content_integrity hashes describe and the one
// packs/watch/descriptor.json's pin refers to, so it is the reference: any divergence
// in a shipped copy means consumers are running code the pin does NOT cover.
//
// This sensor compares the FULL directory tree byte-for-byte (not just SKILL.md, the
// way manifest-skills.spec.js does) because watch's behavior lives in scripts/*.py —
// a SKILL.md-only check would let a modified downloader or Whisper client ship
// unnoticed. Dotfiles (.skillignore) are included for the same reason.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';

const SKILL = 'watch';
const OWNED_DIR = join(REPO_ROOT, 'assimilated-skills', SKILL);
const SHIPPED_DIR = join(REPO_ROOT, 'skills', SKILL);
const DEV_DIR = join(REPO_ROOT, '.claude', 'skills', SKILL);

/**
 * Every file under `dir`, as forward-slash paths relative to `dir`, sorted.
 * Includes dotfiles (readdirSync returns them) — .skillignore is load-bearing.
 */
function fileTree(dir) {
  const out = [];
  const walk = (abs) => {
    for (const name of readdirSync(abs).sort()) {
      const child = join(abs, name);
      if (statSync(child).isDirectory()) walk(child);
      else out.push(relative(dir, child).split('\\').join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

describe('TASK-180 — watch ships out of the box and never drifts from the pinned copy', () => {
  it('the owned copy exists and is the reference for the shipped copies', () => {
    expect(existsSync(OWNED_DIR), `${OWNED_DIR} must exist (owned/pinned copy)`).toBe(true);
    expect(existsSync(join(OWNED_DIR, 'SKILL.md'))).toBe(true);
  });

  it('watch ships at plugin-root skills/ so a plugin install exposes it with zero setup', () => {
    // The load-bearing assertion for the human directive: Claude Code auto-discovers
    // plugin skills ONLY from plugin-root skills/. Without this file on disk a consumer
    // install has no watch skill until pack-ctl reconcile-apply is run by hand.
    expect(
      existsSync(join(SHIPPED_DIR, 'SKILL.md')),
      'skills/watch/SKILL.md must exist — it is what makes /hivemind:watch load on install',
    ).toBe(true);
  });

  it.each([
    ['skills/watch', () => SHIPPED_DIR],
    ['.claude/skills/watch', () => DEV_DIR],
  ])('%s carries exactly the same files as assimilated-skills/watch', (_label, dirFn) => {
    expect(fileTree(dirFn())).toEqual(fileTree(OWNED_DIR));
  });

  it.each([
    ['skills/watch', () => SHIPPED_DIR],
    ['.claude/skills/watch', () => DEV_DIR],
  ])('%s is byte-identical to assimilated-skills/watch, file for file', (label, dirFn) => {
    const dir = dirFn();
    for (const rel of fileTree(OWNED_DIR)) {
      const owned = readFileSync(join(OWNED_DIR, rel));
      const copy = readFileSync(join(dir, rel));
      expect(
        copy.equals(owned),
        `${label}/${rel} differs from the pinned assimilated-skills/watch/${rel} — ` +
        'the shipped copy must never drift from the copy the provenance hashes cover',
      ).toBe(true);
    }
  });

  it('the shipped copy preserves the provenance block verbatim', () => {
    // Origin/pin/integrity are the supply-chain record. Regenerating or editing them in
    // a shipped copy would silently relabel third-party code as something else.
    const md = readFileSync(join(SHIPPED_DIR, 'SKILL.md'), 'utf8');
    expect(md).toContain('origin: github.com/bradautomates/claude-video');
    expect(md).toContain('pin: 83da59fa78c3eee9e20f515fe75c438bb5166efd');
    expect(/^- source_integrity: sha256:[0-9a-f]{64}$/m.test(md), 'source_integrity').toBe(true);
    expect(/^- content_integrity: sha256:[0-9a-f]{64}$/m.test(md), 'content_integrity').toBe(true);
  });

  it('the pack path is left intact — watch is still a reconcilable pack resource', () => {
    // Shipping at plugin root is ADDITIVE. Dropping the pack resource would make the
    // reconciler compute a REMOVE op against projects that already installed watch via
    // integrations.lock.json, deleting a working skill from existing consumers.
    const descriptor = JSON.parse(
      readFileSync(join(REPO_ROOT, 'packs', SKILL, 'descriptor.json'), 'utf8'),
    );
    expect(descriptor.id).toBe(SKILL);
    const resource = descriptor.resources.find((r) => r.id === SKILL);
    expect(resource, 'packs/watch/descriptor.json must still declare the watch resource').toBeTruthy();
    expect(resource.kind).toBe('skill');
    expect(resource.pin).toBe('83da59fa78c3eee9e20f515fe75c438bb5166efd');
  });
});
