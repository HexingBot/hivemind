#!/usr/bin/env node
// scripts/test-since.mjs — validating wrapper behind `npm run test:since -- <base-ref>`.
//
// TASK-081 HIGH-1 (deep-review): the bare npm script `vitest run --changed
// <ref>` had two silent-false-positive failure modes, both surfaced by the
// reviewer re-running it against its own base ref:
//
//   1. cac (vitest's CLI parser) coerces an all-digit positional arg (e.g.
//      "7627532") to a JS number. vitest's git module only honors --changed
//      when `typeof changedSince === "string"` (node_modules/vitest/dist/
//      chunks/git.B5SDxu-n.js) — a numeric ref is silently DROPPED and
//      --changed degrades to staged+unstaged only, which is empty on a
//      clean tree => 0 specs selected, exit 0.
//   2. An invalid/unknown ref makes the underlying `git diff` fail, but
//      vitest's git wrapper (tinyexec) does not throw on a non-zero exit by
//      default — it returns empty stdout, which vitest reads as "0 files
//      changed" => 0 specs selected, exit 0. Same silent green-on-nothing.
//
// This wrapper resolves and validates the ref with `git rev-parse --verify`
// BEFORE invoking vitest, fails loudly (non-zero exit + message) if the ref
// doesn't resolve, and forwards a `<full-sha>~0` form to vitest — a string
// that can never be all-digit, so cac cannot re-coerce it to a number.
//
// `resolveSafeRef` is exported (injectable `exec`) so tests/test-since.spec.js
// can lock the numeric-coercion and invalid-ref branches deterministically,
// without spawning a real git process or the (slow) inner vitest run.

import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/**
 * Resolve `ref` to a git commit and return a vitest-`--changed`-safe value.
 * `exec` is injectable for tests (default: real `git rev-parse --verify`).
 * Returns `{ ok: true, safeRef }` or `{ ok: false, message }`.
 */
export function resolveSafeRef(ref, exec = spawnSync) {
  if (!ref) {
    return { ok: false, message: 'usage: npm run test:since -- <base-ref> [extra vitest args...]' };
  }

  const verify = exec('git', ['rev-parse', '--verify', `${ref}^{commit}`], { encoding: 'utf8' });

  if (verify.status !== 0) {
    return {
      ok: false,
      message:
        `test:since: "${ref}" did not resolve to a commit (git rev-parse --verify failed).\n` +
        (verify.stderr || '') +
        '\nRefusing to run vitest --changed with an unresolved ref: that mode ' +
        'silently selects zero specs and reports green rather than failing.',
    };
  }

  // `~0` is a no-op revision suffix (zero commits before <sha>) that resolves
  // to the identical commit — it exists purely so the forwarded string always
  // contains a non-digit character and cac cannot coerce it to a number.
  return { ok: true, safeRef: `${verify.stdout.trim()}~0` };
}

function main(argv = process.argv.slice(2)) {
  const [ref, ...extraArgs] = argv;
  const resolved = resolveSafeRef(ref);

  if (!resolved.ok) {
    process.stderr.write(resolved.message + '\n');
    process.exit(ref ? 1 : 2);
  }

  process.stderr.write(
    `test:since: resolved "${ref}" -> ${resolved.safeRef} (forwarded as a string; never all-digit)\n`,
  );

  const result = spawnSync(
    'vitest',
    ['run', '--config', 'vitest.config.all.js', '--changed', resolved.safeRef, ...extraArgs],
    { stdio: 'inherit', shell: true },
  );

  if (result.error) {
    process.stderr.write(`test:since: failed to launch vitest: ${result.error.message}\n`);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
