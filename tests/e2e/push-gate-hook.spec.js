// tests/e2e/push-gate-hook.spec.js
// WG4-236-001 (4th wargaming pass, 2026-09-17) — the push half of Gate 1 in
// commands/loop.md is enforced by a Claude Code PreToolUse hook: a documented
// recipe whose command is a self-contained `node -e` string (it cannot import
// this repo's src/ — the recipe is copied verbatim into a consumer's
// .claude/settings.json). The 4th pass found the earlier version fail-OPEN:
// on ANY read failure it fell through to exit 0 (allow), so an externally
// symlinked state/sessions/ with a remote auto_push_after_close:true sailed
// through, and a truncated bundle also passed — "a push is more destructive
// than a close, and the ticket declared closed a class that is still alive in
// the sibling gate".
//
// This spec extracts the recipe's command out of commands/loop.md, runs it
// through a REAL shell (bash -c, the same way Claude Code would execute it)
// against disposable sandboxes, and requires:
//   allow (0)  — only for legitimate absence: no state/ (harness), no active
//                session id, non-loop bundle, non-push command, or a granted
//                auto_push_after_close in a REAL, singly-linked, un-symlinked
//                bundle.
//   block (2)  — loop mode without the grant, and EVERY corruption shape:
//                corrupt pointer, truncated bundle, symlinked sessions dir,
//                symlinked session.json, hardlinked session.json.
//
// The recipe is a documented string, so this is a text-extraction test like
// the other policy-propagation locks (same trade: it pins what ships, not an
// importable module — there is deliberately no module to import).

import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, rmSync, symlinkSync, linkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { REPO_ROOT } from '../helpers/repoRoot.js';

afterAll(cleanupAll);

// ---------------------------------------------------------------------------
// Extract the PreToolUse hook command out of commands/loop.md
// ---------------------------------------------------------------------------
const loopMd = readFileSync(join(REPO_ROOT, 'commands', 'loop.md'), 'utf8');
const fenceMatch = loopMd.match(/```json\n([\s\S]*?)\n```/);
if (!fenceMatch) throw new Error('commands/loop.md has no json fence block — recipe missing');
const recipe = JSON.parse(fenceMatch[1]);
const hookCommand = recipe.hooks.PreToolUse[0].hooks[0].command;
if (typeof hookCommand !== 'string' || !hookCommand.startsWith('node -e ')) {
  throw new Error('commands/loop.md hook command must be a "node -e ..." string');
}

const PAYLOAD_PUSH = JSON.stringify({ tool_input: { command: 'git push origin main' } });
const PAYLOAD_NONPUSH = JSON.stringify({ tool_input: { command: 'git status' } });

/** Run the hook command (through a real shell, like Claude Code would) in
 * `cwd` with `payload` on stdin; returns the exit code. */
function runHook(cwd, payload = PAYLOAD_PUSH) {
  try {
    execFileSync('bash', ['-c', `echo "$1" | ${hookCommand}`, 'x', payload], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    return 0;
  } catch (err) {
    return typeof err.status === 'number' ? err.status : 1;
  }
}

/** Build a sandbox: real pointer + real bundle in loop mode with the given
 * loop_auth. Returns the sandbox root. */
function makeSandbox({ loopAuth, mode = 'loop', corruptPointer = false, truncated = false, sessionsDirSymlink = null, bundleFileSymlink = null, bundleHardlink = null, noState = false } = {}) {
  const root = makeTmpDir('af-pgh');
  if (noState) return root;
  mkdirSync(join(root, 'state', 'sessions', 's1'), { recursive: true });
  writeFileSync(
    join(root, 'state', 'session.json'),
    corruptPointer ? 'not-json' : JSON.stringify({ active_session_id: 's1' }),
    'utf8',
  );
  const bundle = { mode, loop_auth: loopAuth };
  const bundlePath = join(root, 'state', 'sessions', 's1', 'session.json');
  if (truncated) {
    writeFileSync(bundlePath, '{"mode":"loop"', 'utf8');
  } else if (bundleFileSymlink) {
    writeFileSync(bundleFileSymlink, JSON.stringify(bundle), 'utf8');
    symlinkSync(bundleFileSymlink, bundlePath);
  } else if (bundleHardlink) {
    writeFileSync(bundleHardlink, JSON.stringify(bundle), 'utf8');
    linkSync(bundleHardlink, bundlePath);
  } else {
    writeFileSync(bundlePath, JSON.stringify(bundle), 'utf8');
  }
  if (sessionsDirSymlink) {
    rmSync(join(root, 'state', 'sessions'), { recursive: true, force: true });
    mkdirSync(join(sessionsDirSymlink, 's1'), { recursive: true });
    writeFileSync(
      join(sessionsDirSymlink, 's1', 'session.json'),
      JSON.stringify({ mode, loop_auth: { auto_push_after_close: true } }),
      'utf8',
    );
    symlinkSync(sessionsDirSymlink, join(root, 'state', 'sessions'));
  }
  return root;
}

const AUTHD = { auto_push_after_close: true };
const NOT_AUTHD = { auto_push_after_close: false };

describe('WG4-236-001 — the Gate 1 push hook is fail-open only for legitimate absence, fail-closed for corruption', () => {
  it('allows a push when loop mode has auto_push_after_close granted in a real bundle', () => {
    const root = makeSandbox({ loopAuth: AUTHD });
    expect(runHook(root)).toBe(0);
  });

  it('blocks a push in loop mode without the grant (the base gate)', () => {
    const root = makeSandbox({ loopAuth: NOT_AUTHD });
    expect(runHook(root)).toBe(2);
  });

  it('allows a push when no state/ exists at all (harness mode)', () => {
    const root = makeSandbox({ noState: true });
    expect(runHook(root)).toBe(0);
  });

  it('allows a push when the bundle mode is not loop', () => {
    const root = makeSandbox({ loopAuth: AUTHD, mode: 'harness' });
    expect(runHook(root)).toBe(0);
  });

  it('allows a non-push Bash command untouched even in unauthenticated loop mode', () => {
    const root = makeSandbox({ loopAuth: NOT_AUTHD });
    expect(runHook(root, PAYLOAD_NONPUSH)).toBe(0);
  });

  it('allows a push when the pointer has no active session id', () => {
    const root = makeTmpDir('af-pgh-nosid');
    mkdirSync(join(root, 'state'), { recursive: true });
    writeFileSync(join(root, 'state', 'session.json'), '{}', 'utf8');
    expect(runHook(root)).toBe(0);
  });

  it('BLOCKS when the pointer is corrupt (fail-closed — a session may be live)', () => {
    const root = makeSandbox({ loopAuth: AUTHD, corruptPointer: true });
    expect(runHook(root)).toBe(2);
  });

  it('BLOCKS when the bundle is truncated/corrupt (fail-closed — cannot verify the grant)', () => {
    const root = makeSandbox({ loopAuth: AUTHD, truncated: true });
    expect(runHook(root)).toBe(2);
  });

  it('BLOCKS when state/sessions/ is a symlink to an external dir carrying the grant', () => {
    const external = join(makeTmpDir('af-pgh-ext'), 'sessions');
    const root = makeSandbox({ sessionsDirSymlink: external });
    // The external bundle grants the push; the symlinked container must still block it.
    expect(runHook(root)).toBe(2);
  });

  it('BLOCKS when the bundle file itself is a symlink to an external authed file', () => {
    const external = join(makeTmpDir('af-pgh-extfile'), 'external-authed.json');
    const root = makeSandbox({ bundleFileSymlink: external });
    expect(runHook(root)).toBe(2);
  });

  it('BLOCKS when the bundle file is hardlinked to an external authed file', () => {
    const external = join(makeTmpDir('af-pgh-hard'), 'external-authed.json');
    const root = makeSandbox({ bundleHardlink: external });
    expect(runHook(root)).toBe(2);
  });

  it('the recipe still reads the pointer then the session bundle (sanity: the hook is not vacuous)', () => {
    expect(hookCommand).toContain('active_session_id');
    expect(hookCommand).toContain('auto_push_after_close');
    expect(hookCommand).toContain('lstatSync'); // WG4-236-002 containment is inline
  });
});
