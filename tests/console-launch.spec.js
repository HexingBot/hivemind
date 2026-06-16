// tests/console-launch.spec.js
// TASK-056 — Regression locks for the one-click launcher, /console command,
// and the --open flag added to bin/task-board.js.
//
// Verification tier: tests-after (per TASK-056 plan).
// Every assertion encodes an AC from the ticket — no padding.

import { describe, it, expect, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';

// ---------------------------------------------------------------------------
// AC1 — one-click launchers exist at repo root, reference the bundle + fixed
// port 4517. The Windows launcher must also reference the dist bundle path.
// ---------------------------------------------------------------------------
describe('AC1 — one-click launcher scripts', () => {
  const cmdPath = join(REPO_ROOT, 'console.cmd');
  const shPath = join(REPO_ROOT, 'console.sh');

  it('console.cmd exists at repo root', () => {
    expect(existsSync(cmdPath), 'console.cmd must exist at repo root').toBe(true);
  });

  it('console.sh exists at repo root', () => {
    expect(existsSync(shPath), 'console.sh must exist at repo root').toBe(true);
  });

  it('console.cmd is non-empty', () => {
    const content = readFileSync(cmdPath, 'utf8');
    expect(content.trim().length, 'console.cmd must not be empty').toBeGreaterThan(0);
  });

  it('console.sh is non-empty', () => {
    const content = readFileSync(shPath, 'utf8');
    expect(content.trim().length, 'console.sh must not be empty').toBeGreaterThan(0);
  });

  it('console.cmd references the task-board dist bundle', () => {
    const content = readFileSync(cmdPath, 'utf8');
    expect(content).toMatch(/task-board\.cjs/);
  });

  it('console.sh references the task-board dist bundle', () => {
    const content = readFileSync(shPath, 'utf8');
    expect(content).toMatch(/task-board\.cjs/);
  });

  it('console.cmd uses the fixed port 4517', () => {
    const content = readFileSync(cmdPath, 'utf8');
    expect(content).toMatch(/4517/);
  });

  it('console.sh uses the fixed port 4517', () => {
    const content = readFileSync(shPath, 'utf8');
    expect(content).toMatch(/4517/);
  });

  it('console.cmd includes --open flag to launch the browser', () => {
    const content = readFileSync(cmdPath, 'utf8');
    expect(content).toMatch(/--open/);
  });

  it('console.sh includes --open flag to launch the browser', () => {
    const content = readFileSync(shPath, 'utf8');
    expect(content).toMatch(/--open/);
  });

  it('console.sh has a sh/env shebang', () => {
    const content = readFileSync(shPath, 'utf8');
    expect(content.startsWith('#!/usr/bin/env sh'), 'console.sh must start with a sh shebang').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC1 — bin/task-board.js parses --open flag (source-grep lock).
// ---------------------------------------------------------------------------
describe('AC1 — bin/task-board.js --open flag', () => {
  const binPath = join(REPO_ROOT, 'bin', 'task-board.js');

  it('bin/task-board.js handles --open token in parseArgs', () => {
    const src = readFileSync(binPath, 'utf8');
    expect(src).toMatch(/--open/);
  });

  it('bin/task-board.js exports openBrowser function', async () => {
    // Import the module and confirm the function is exported.
    // The __isEntryScript guard means the server is NOT started on import.
    const mod = await import(join(REPO_ROOT, 'bin', 'task-board.js'));
    expect(typeof mod.openBrowser).toBe('function');
  });

  it('openBrowser calls spawn best-effort and does not throw on failure', async () => {
    const mod = await import(join(REPO_ROOT, 'bin', 'task-board.js'));
    // Inject a spy that throws — the function must swallow it silently.
    const failingSpawn = () => { throw new Error('spawn failed'); };
    expect(() => mod.openBrowser('http://127.0.0.1:4517', failingSpawn)).not.toThrow();
  });

  it('openBrowser invokes the spawn function with the URL', async () => {
    const mod = await import(join(REPO_ROOT, 'bin', 'task-board.js'));
    let capturedArgs = null;
    const fakeSpawn = (_cmd, args, _opts) => {
      capturedArgs = args;
      return { unref: () => {} };
    };
    mod.openBrowser('http://127.0.0.1:4517', fakeSpawn);
    expect(capturedArgs).not.toBeNull();
    // The URL must appear somewhere in the args list.
    expect(capturedArgs.some((a) => a.includes('127.0.0.1:4517'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC2 — /console slash command exists and follows command conventions.
// ---------------------------------------------------------------------------
describe('AC2 — commands/console.md slash command', () => {
  const consoleCmdPath = join(REPO_ROOT, 'commands', 'console.md');

  it('commands/console.md exists', () => {
    expect(existsSync(consoleCmdPath), 'commands/console.md must exist').toBe(true);
  });

  it('commands/console.md has YAML frontmatter with a description field', () => {
    const content = readFileSync(consoleCmdPath, 'utf8');
    expect(content).toMatch(/^---\s*[\r\n]/);
    expect(content).toMatch(/description:/);
  });

  it('commands/console.md references dist/task-board.cjs', () => {
    const content = readFileSync(consoleCmdPath, 'utf8');
    expect(content).toMatch(/dist\/task-board\.cjs/);
  });

  it('commands/console.md mentions the local URL (127.0.0.1)', () => {
    const content = readFileSync(consoleCmdPath, 'utf8');
    expect(content).toMatch(/127\.0\.0\.1/);
  });
});

// ---------------------------------------------------------------------------
// AC6 — version bump: both pin sites agree on 0.5.0.
// (Complements publish-config.spec.js which enforces plugin.json shape.)
// ---------------------------------------------------------------------------
describe('AC6 — version pin consistency 0.4.0 -> 0.5.0', () => {
  it('plugin.json carries version 0.5.0', () => {
    const pluginJson = JSON.parse(
      readFileSync(join(REPO_ROOT, '.claude-plugin', 'plugin.json'), 'utf8'),
    );
    expect(pluginJson.version).toBe('0.5.0');
  });

  it('publish-config.spec.js EXPECTED_VERSION is 0.5.0', () => {
    const src = readFileSync(join(REPO_ROOT, 'tests', 'publish-config.spec.js'), 'utf8');
    expect(src).toMatch(/EXPECTED_VERSION\s*=\s*'0\.5\.0'/);
  });
});
