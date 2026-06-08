// tests/backlog-seeder-hardening-init.spec.js
// TASK-017 AC5 — bin/init.js wraps the seedBacklog call in a try/catch that
// prints a user-visible warning on failure and re-throws. Lives in its own
// spec file (sibling to tests/backlog-seeder-hardening.spec.js) because the
// `vi.mock('../../src/backlog-seeder.js')` factory below is hoisted to the top
// of the file and would override the real seeder for every other test in the
// hardening suite.
//
// Design lock: propagate-with-warning, NOT silent-continue. A half-seeded
// backlog corrupts the idempotency guard for any future --force re-run, so
// the user must learn about the failure immediately.

import {
  describe, it, expect, vi, afterAll, afterEach, beforeEach,
} from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { PROD } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { makeScriptedPrompter, webSaasAnswers } from '../helpers/scripted-prompter.js';

afterAll(cleanupAll);

const FIXED_NOW = '2026-05-28T12:00:00Z';

// The mock factory must resolve to the SAME module bin/init.js imports
// (repo/src/backlog-seeder.js). Vitest resolves the `vi.mock` specifier
// against THIS test file's directory — and this spec lives in tests/e2e/,
// so reaching repo/src takes two hops up: `../../src/backlog-seeder.js`.
vi.mock('../../src/backlog-seeder.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    seedBacklog: vi.fn(async () => {
      throw new Error('simulated seeder failure (EACCES on disk)');
    }),
  };
});

describe('AC5 — init.js wraps seedBacklog in warn-and-rethrow try/catch', () => {
  let warnSpy;
  let errSpy;
  let logSpy;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
    errSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('init_emits_warning_and_rethrows_when_seeder_fails', async () => {
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-seed-init-fail');
    const prompter = makeScriptedPrompter(webSaasAnswers());

    let caught = null;
    try {
      await runInit({
        argv: [],
        prompter,
        repoRoot: repoDir,
        now: () => FIXED_NOW,
      });
    } catch (err) {
      caught = err;
    }

    // Lock: propagate-with-warning. The seeder error must surface to the
    // caller — silent continue would hide a half-mint, which corrupts
    // idempotency for any future --force re-run.
    expect(
      caught,
      'init must re-throw the seeder failure (no silent swallow)',
    ).not.toBeNull();
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught.message)).toMatch(/simulated seeder failure/);

    // PROJECT.md and project-context.md were both written before the seeder
    // ran — they must still be on disk after the failure.
    expect(
      existsSync(join(repoDir, 'PROJECT.md')),
      'PROJECT.md must survive seeder failure (written before seeder)',
    ).toBe(true);
    expect(
      existsSync(join(repoDir, '.claude', 'agents', 'project-context.md')),
      '.claude/agents/project-context.md must survive seeder failure (written before seeder)',
    ).toBe(true);

    // A user-visible warning must have fired before the re-throw. The
    // implementation may use console.warn or console.error; both are
    // acceptable user-facing surfaces. The message must reference the seeder
    // so the user can locate the failing step.
    const warnCalls = warnSpy.mock.calls.map((args) => args.join(' '));
    const errCalls = errSpy.mock.calls.map((args) => args.join(' '));
    const allOutput = [...warnCalls, ...errCalls].join('\n');
    expect(
      /seed/i.test(allOutput),
      `expected a warning/error mentioning the seeder failure — got warn=${JSON.stringify(warnCalls)} err=${JSON.stringify(errCalls)}`,
    ).toBe(true);
  });
});
