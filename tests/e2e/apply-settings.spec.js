// tests/e2e/apply-settings.spec.js
// TASK-009 — Regression locks for the --apply-settings flag in bin/init.js.
//
// The --apply-workflows short-circuit (Branch 0b) exits before writeClaudeSettings
// is called, so existing projects initialized without context-autoflush never get
// the settings.json wiring. This spec verifies the new --apply-settings mode.
//
// AC map (TASK-009 AC2):
//   AC2a — --apply-settings on an already-initialized project writes settings.json
//   AC2b — --apply-settings on an uninitialized project also writes settings.json
//   AC2c — --apply-settings is idempotent: re-running does not duplicate entries
//   AC2d — --apply-settings does NOT touch PROJECT.md or mint a session bundle
//   AC2e — --apply-settings cannot be combined with --force or --answers-file

import { describe, it, expect, afterAll } from 'vitest';
import {
  existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync,
} from 'node:fs';
import { join } from 'node:path';

import { PROD } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { makeScriptedPrompter, webSaasAnswers } from '../helpers/scripted-prompter.js';

afterAll(cleanupAll);

const FIXED_NOW = '2026-06-17T12:00:00Z';

/** A prompter that throws if invoked — proves --apply-settings never calls the wizard. */
function throwIfCalled() {
  return async (ctx) => {
    throw new Error(`prompter must not be called by --apply-settings: ${JSON.stringify(ctx)}`);
  };
}

// ---------------------------------------------------------------------------
// AC2a — --apply-settings on an already-initialized project writes settings.json
// ---------------------------------------------------------------------------

describe('AC2a — --apply-settings on already-initialized project writes settings.json', () => {
  it('adds context-monitor settings.json wiring to an existing initialized project', async () => {
    const { runInit } = await import(PROD.init);
    const repoDir = makeTmpDir('af-as-retrofit');

    // Phase 1: full wizard init (creates PROJECT.md, session bundle, but no settings.json
    // because we'll simulate the pre-TASK-009 state by deleting it after).
    const prompter = makeScriptedPrompter(webSaasAnswers({ project_name: 'as-retrofit' }));
    const initResult = await runInit({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });
    expect(['created', 'forced']).toContain(initResult.state);

    // Simulate pre-TASK-009 state: delete settings.json so the project looks like
    // it was initialized before the context-autoflush feature existed.
    const settingsPath = join(repoDir, '.claude', 'settings.json');
    if (existsSync(settingsPath)) {
      const { rmSync } = await import('node:fs');
      rmSync(settingsPath);
    }
    expect(existsSync(settingsPath)).toBe(false);

    // Capture PROJECT.md for the byte-identity check.
    const projectMdPath = join(repoDir, 'PROJECT.md');
    const projectMdBefore = readFileSync(projectMdPath, 'utf8');

    // Phase 2: run --apply-settings on the already-initialized project.
    const applyResult = await runInit({
      argv: ['--apply-settings'],
      prompter: throwIfCalled(),
      repoRoot: repoDir,
      now: () => '2099-01-01T00:00:00Z',
    });

    expect(applyResult.state).toBe('applied_settings');

    // settings.json must now exist.
    expect(existsSync(settingsPath), '.claude/settings.json must be created by --apply-settings').toBe(true);

    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    expect(settings.statusLine, 'statusLine must be added').toBeDefined();
    expect(settings.statusLine.command).toMatch(/statusline\.mjs/);
    expect(settings.hooks, 'hooks must be added').toBeDefined();
    expect(Array.isArray(settings.hooks.Stop)).toBe(true);
    expect(Array.isArray(settings.hooks.SessionStart)).toBe(true);
    expect(settings.hooks.Stop.some((h) => /stop-hook\.mjs/.test(h.command))).toBe(true);
    expect(settings.hooks.SessionStart.some((h) => /session-start\.mjs/.test(h.command))).toBe(true);

    // PROJECT.md must be byte-identical (--apply-settings must not touch it).
    expect(readFileSync(projectMdPath, 'utf8')).toBe(projectMdBefore);
  });
});

// ---------------------------------------------------------------------------
// AC2b — --apply-settings on an uninitialized project also writes settings.json
// ---------------------------------------------------------------------------

describe('AC2b — --apply-settings on uninitialized project writes settings.json', () => {
  it('writes settings.json even when PROJECT.md does not exist yet', async () => {
    const { runInit } = await import(PROD.init);
    const repoDir = makeTmpDir('af-as-notinit');

    // Confirm no PROJECT.md exists.
    expect(existsSync(join(repoDir, 'PROJECT.md'))).toBe(false);

    const applyResult = await runInit({
      argv: ['--apply-settings'],
      prompter: throwIfCalled(),
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    expect(applyResult.state).toBe('applied_settings');

    const settingsPath = join(repoDir, '.claude', 'settings.json');
    expect(existsSync(settingsPath), '.claude/settings.json must be created').toBe(true);

    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    expect(settings.statusLine).toBeDefined();
    expect(settings.hooks.Stop.some((h) => /stop-hook\.mjs/.test(h.command))).toBe(true);
    expect(settings.hooks.SessionStart.some((h) => /session-start\.mjs/.test(h.command))).toBe(true);

    // PROJECT.md must NOT be created.
    expect(existsSync(join(repoDir, 'PROJECT.md'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC2c — --apply-settings is idempotent: re-running does not duplicate entries
// ---------------------------------------------------------------------------

describe('AC2c — --apply-settings is idempotent: no duplicate entries', () => {
  it('running --apply-settings twice does not duplicate Stop or SessionStart hooks', async () => {
    const { runInit } = await import(PROD.init);
    const repoDir = makeTmpDir('af-as-idemp');

    // First run.
    await runInit({
      argv: ['--apply-settings'],
      prompter: throwIfCalled(),
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    const settingsPath = join(repoDir, '.claude', 'settings.json');
    const afterFirst = JSON.parse(readFileSync(settingsPath, 'utf8'));
    const stopCount1 = afterFirst.hooks.Stop.filter((h) => /stop-hook\.mjs/.test(h.command)).length;
    const ssCount1 = afterFirst.hooks.SessionStart.filter((h) => /session-start\.mjs/.test(h.command)).length;

    // Second run.
    await runInit({
      argv: ['--apply-settings'],
      prompter: throwIfCalled(),
      repoRoot: repoDir,
      now: () => '2099-01-01T00:00:00Z',
    });

    const afterSecond = JSON.parse(readFileSync(settingsPath, 'utf8'));
    const stopCount2 = afterSecond.hooks.Stop.filter((h) => /stop-hook\.mjs/.test(h.command)).length;
    const ssCount2 = afterSecond.hooks.SessionStart.filter((h) => /session-start\.mjs/.test(h.command)).length;

    expect(stopCount2).toBe(stopCount1);
    expect(ssCount2).toBe(ssCount1);
  });
});

// ---------------------------------------------------------------------------
// AC2d — --apply-settings does NOT touch PROJECT.md or mint a session bundle
// ---------------------------------------------------------------------------

describe('AC2d — --apply-settings does not touch PROJECT.md or mint a session bundle', () => {
  it('does not create PROJECT.md on an uninitialized project', async () => {
    const { runInit } = await import(PROD.init);
    const repoDir = makeTmpDir('af-as-noprojectmd');

    await runInit({
      argv: ['--apply-settings'],
      prompter: throwIfCalled(),
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    expect(existsSync(join(repoDir, 'PROJECT.md'))).toBe(false);
  });

  it('does not mint a session bundle', async () => {
    const { runInit } = await import(PROD.init);
    const repoDir = makeTmpDir('af-as-nobundle');

    await runInit({
      argv: ['--apply-settings'],
      prompter: throwIfCalled(),
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    const sessionsDir = join(repoDir, 'state', 'sessions');
    const sessions = existsSync(sessionsDir) ? readdirSync(sessionsDir) : [];
    expect(sessions).toHaveLength(0);

    // state/session.json pointer must not exist.
    expect(existsSync(join(repoDir, 'state', 'session.json'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC2e — --apply-settings exclusivity: conflicting flag combinations throw
// ---------------------------------------------------------------------------

describe('AC2e — --apply-settings exclusivity: conflicting flag combinations throw', () => {
  it('--apply-settings combined with --force throws before any filesystem write', async () => {
    const { runInit } = await import(PROD.init);
    const repoDir = makeTmpDir('af-as-force-combo');

    await expect(
      runInit({
        argv: ['--apply-settings', '--force'],
        prompter: throwIfCalled(),
        repoRoot: repoDir,
        now: () => FIXED_NOW,
      }),
    ).rejects.toThrow(/--apply-settings/);

    // No settings.json created.
    expect(existsSync(join(repoDir, '.claude', 'settings.json'))).toBe(false);
  });

  it('--apply-settings combined with --answers-file throws before any filesystem write', async () => {
    const { runInit } = await import(PROD.init);
    const repoDir = makeTmpDir('af-as-answersfile-combo');

    await expect(
      runInit({
        argv: ['--apply-settings', '--answers-file', 'answers.json'],
        prompter: throwIfCalled(),
        repoRoot: repoDir,
        now: () => FIXED_NOW,
      }),
    ).rejects.toThrow(/--apply-settings/);

    expect(existsSync(join(repoDir, '.claude', 'settings.json'))).toBe(false);
  });
});
