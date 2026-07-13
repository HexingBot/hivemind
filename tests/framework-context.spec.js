// tests/framework-context.spec.js
// TASK-152 — isFrameworkRepo({ repoRoot }) detector.
//
// Distinguishes "this repo IS the hivemind framework" from "a project built
// with hivemind". Pure logic, read-only fs checks against static checked-in
// fixture directories under tests/fixtures/framework-context/ — no mkdtemp,
// no process spawn, so this belongs in the fast tier.
//
// ACs covered (tasks/TASK-152.json):
//  - true for the hivemind repo root itself (real layout: plugin.json
//    name==='hivemind' + src/ + bin/init.js all present).
//  - false for a consumer-project fixture (PROJECT.md present, no src/ +
//    bin/init.js, foreign plugin.json name).
//  - false for a plugin.json whose name !== 'hivemind' even when src/ +
//    bin/init.js ARE present (name gate is independent of the other checks).
//  - false (never throws) when .claude-plugin/plugin.json is missing.
//  - false (never throws) when .claude-plugin/plugin.json is malformed JSON.
//  - false when src/ is absent even if plugin.json name==='hivemind'
//    (guards against a partial checkout).
//  - verdict does not depend on CLAUDE_PROJECT_NAME / other env / cwd.
//
// All tests MUST FAIL with "Cannot find module …framework-context.js" until
// src/framework-context.js is created in the IMPL phase — that is the
// correct RED state for TDD mode.

import { describe, it, expect } from 'vitest';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';

const FRAMEWORK_CONTEXT_URL = pathToFileURL(
  join(REPO_ROOT, 'src', 'framework-context.js'),
).href;

const FIXTURES = join(REPO_ROOT, 'tests', 'fixtures', 'framework-context');

describe('isFrameworkRepo — module shape', () => {
  it('exports isFrameworkRepo as a function', async () => {
    const mod = await import(FRAMEWORK_CONTEXT_URL);
    expect(typeof mod.isFrameworkRepo).toBe('function');
  });
});

describe('isFrameworkRepo — real framework layout', () => {
  it('returns true for the actual hivemind repo root (this repo)', async () => {
    const { isFrameworkRepo } = await import(FRAMEWORK_CONTEXT_URL);
    expect(isFrameworkRepo({ repoRoot: REPO_ROOT })).toBe(true);
  });

  it('returns true for a synthetic fixture with the same shape (plugin.json name===hivemind, src/, bin/init.js)', async () => {
    const { isFrameworkRepo } = await import(FRAMEWORK_CONTEXT_URL);
    expect(isFrameworkRepo({ repoRoot: join(FIXTURES, 'real-framework') })).toBe(true);
  });
});

describe('isFrameworkRepo — consumer-project layout', () => {
  it('returns false for a consumer-project fixture (PROJECT.md, no src/ + bin/init.js, foreign plugin.json name)', async () => {
    const { isFrameworkRepo } = await import(FRAMEWORK_CONTEXT_URL);
    expect(isFrameworkRepo({ repoRoot: join(FIXTURES, 'consumer-project') })).toBe(false);
  });

  it('returns false when plugin.json name !== "hivemind" even with src/ and bin/init.js present', async () => {
    const { isFrameworkRepo } = await import(FRAMEWORK_CONTEXT_URL);
    expect(isFrameworkRepo({ repoRoot: join(FIXTURES, 'foreign-plugin-name') })).toBe(false);
  });
});

describe('isFrameworkRepo — missing / malformed plugin.json (never throws)', () => {
  it('returns false when .claude-plugin/plugin.json is missing entirely', async () => {
    const { isFrameworkRepo } = await import(FRAMEWORK_CONTEXT_URL);
    expect(() => isFrameworkRepo({ repoRoot: FIXTURES })).not.toThrow();
    expect(isFrameworkRepo({ repoRoot: FIXTURES })).toBe(false);
  });

  it('returns false when plugin.json is malformed JSON', async () => {
    const { isFrameworkRepo } = await import(FRAMEWORK_CONTEXT_URL);
    const repoRoot = join(FIXTURES, 'malformed-plugin-json');
    expect(() => isFrameworkRepo({ repoRoot })).not.toThrow();
    expect(isFrameworkRepo({ repoRoot })).toBe(false);
  });

  it('returns false for a repoRoot that does not exist at all', async () => {
    const { isFrameworkRepo } = await import(FRAMEWORK_CONTEXT_URL);
    const repoRoot = join(FIXTURES, 'this-path-does-not-exist');
    expect(() => isFrameworkRepo({ repoRoot })).not.toThrow();
    expect(isFrameworkRepo({ repoRoot })).toBe(false);
  });
});

describe('isFrameworkRepo — missing src/ (partial checkout guard)', () => {
  it('returns false when src/ is absent even though plugin.json name==="hivemind" and bin/init.js exists', async () => {
    const { isFrameworkRepo } = await import(FRAMEWORK_CONTEXT_URL);
    expect(isFrameworkRepo({ repoRoot: join(FIXTURES, 'missing-src') })).toBe(false);
  });
});

describe('isFrameworkRepo — empty/invalid repoRoot never falls back to cwd', () => {
  it('returns false for an empty-string repoRoot (guards against path.join()+fs silently resolving against cwd)', async () => {
    const { isFrameworkRepo } = await import(FRAMEWORK_CONTEXT_URL);
    const prevCwd = process.cwd();
    try {
      // Point cwd at the real framework repo so a cwd-fallback bug would
      // wrongly return true here; the correct behavior is false regardless.
      process.chdir(REPO_ROOT);
      expect(isFrameworkRepo({ repoRoot: '' })).toBe(false);
    } finally {
      process.chdir(prevCwd);
    }
  });

  it('returns false when repoRoot is undefined/missing from the args object', async () => {
    const { isFrameworkRepo } = await import(FRAMEWORK_CONTEXT_URL);
    expect(isFrameworkRepo({})).toBe(false);
  });
});

describe('isFrameworkRepo — no dependence on env or cwd', () => {
  it('verdict is unaffected by CLAUDE_PROJECT_NAME / other env vars', async () => {
    const { isFrameworkRepo } = await import(FRAMEWORK_CONTEXT_URL);
    const prevEnv = process.env.CLAUDE_PROJECT_NAME;
    try {
      process.env.CLAUDE_PROJECT_NAME = 'totally-not-hivemind';
      expect(isFrameworkRepo({ repoRoot: REPO_ROOT })).toBe(true);
      expect(isFrameworkRepo({ repoRoot: join(FIXTURES, 'consumer-project') })).toBe(false);
    } finally {
      if (prevEnv === undefined) delete process.env.CLAUDE_PROJECT_NAME;
      else process.env.CLAUDE_PROJECT_NAME = prevEnv;
    }
  });

  it('verdict is unaffected by process.cwd() (real repoRoot passed, cwd pointed elsewhere)', async () => {
    const { isFrameworkRepo } = await import(FRAMEWORK_CONTEXT_URL);
    const prevCwd = process.cwd();
    try {
      process.chdir(join(FIXTURES, 'consumer-project'));
      expect(isFrameworkRepo({ repoRoot: REPO_ROOT })).toBe(true);
    } finally {
      process.chdir(prevCwd);
    }
  });
});
