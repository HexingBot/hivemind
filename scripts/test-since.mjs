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
//
// TASK-192 AC4 — a THIRD silent-false-positive mode, distinct from the two
// above: even a fully-resolved, well-formed ref can select zero specs, and
// `vitest run` exits 0 either way (`resolved.passWithNoTests ??= true` is
// vitest's own default — see resolveConfig.rBxzbVsl.js — so exit code alone
// never distinguishes "0 specs because nothing needed testing" from "0
// specs because the import graph missed something"). CLAUDE.md already
// warned about this in prose; this wrapper now closes it mechanically —
// with output, NOT exit code, carrying the distinction:
//
//   - `hasAnyChangedFiles` mirrors vitest's own change-detection exactly
//     (git.B5SDxu-n.js's getFilesSince/getStagedFiles/getUnstagedFiles: a
//     `<ref>...HEAD` diff, plus staged, plus unstaged) so it answers the
//     same question vitest itself answers, independently of vitest's exit
//     code.
//   - When that check finds NO changed files at all, the zero-spec result is
//     the legitimate "genuinely empty diff" case (verified live against a
//     real ref==HEAD run on a clean tree) — vitest's own "No test files
//     found, exiting with code 0" is correct here, and the wrapper prints a
//     `TEST_SINCE_ZERO_SELECTION: reason=empty-diff` marker so a reader
//     never has to infer it from silence.
//   - When it finds changed files but a fast `vitest list` pre-check (same
//     --changed ref, no test execution) matches zero spec files, the
//     wrapper prints a DISTINCT `TEST_SINCE_ZERO_SELECTION:
//     reason=no-spec-matched` marker naming the files, but does NOT exit
//     non-zero for it. A cross-ticket audit run the same day this AC was
//     implemented found the earlier hard-fail design (committed, then
//     reverted before hand-off) breaks a common legitimate case: a
//     docs-only diff enters no import graph and genuinely, correctly
//     selects zero specs — several real docs-only tickets hit exactly this
//     shape the same day. A blanket non-zero exit here would turn every one
//     of those into a red gate needing manual override on every review,
//     which is alarm fatigue that WEAKENS the control rather than
//     strengthening it (this is the same "empty is always false" trap the
//     ticket's own description explicitly warns against). Making the
//     zero-selection reason SELF-DESCRIBING in the output — not fatal —
//     satisfies AC4's "made unambiguous some other way, with the reasoning
//     recorded" branch: a caller (human or the Reviewer) can now always
//     read WHY zero specs were selected instead of having to infer it, and
//     is still pointed at `npm test` (the fs-read sensors the import graph
//     is blind to) as the actual coverage check for that case.

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

/**
 * TASK-192 AC4 — mirrors vitest's own `--changed` file-detection exactly
 * (node_modules/vitest/dist/chunks/git.B5SDxu-n.js's getFilesSince /
 * getStagedFiles / getUnstagedFiles): a `<safeRef>...HEAD` diff, plus
 * staged, plus unstaged (untracked-but-not-ignored) files. Returns `true`
 * when that union is non-empty. `exec` is injectable for tests (default:
 * real `git diff`/`git ls-files`).
 */
export function hasAnyChangedFiles(safeRef, exec = spawnSync) {
  const runs = [
    ['diff', '--name-only', `${safeRef}...HEAD`],
    ['diff', '--cached', '--name-only'],
    ['ls-files', '--other', '--modified', '--exclude-standard'],
  ];
  return runs.some((args) => {
    const result = exec('git', args, { encoding: 'utf8' });
    // A git failure here is treated conservatively as "there might be
    // changes" (status !== 0 -> non-empty stdout string check below still
    // holds since result.stdout defaults to '' and the `.some` short-
    // circuits false only when EVERY run reports empty stdout) — this keeps
    // the wrapper on the safe side of the "closed mechanically" contract
    // rather than silently treating a git error as "nothing changed".
    return result.status !== 0 || (result.stdout || '').trim().length > 0;
  });
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

  if (hasAnyChangedFiles(resolved.safeRef)) {
    // Fast pre-check (no test execution): does the import graph route ANY
    // of those real, non-empty-diff changes to a spec? This is informational
    // ONLY — see the TASK-192 AC4 header comment for why a non-empty diff
    // that legitimately selects zero specs (a docs-only change, for
    // example) must not become a hard failure here.
    const listCheck = spawnSync(
      'vitest',
      ['list', '--config', 'vitest.config.all.js', '--changed', resolved.safeRef, ...extraArgs],
      { encoding: 'utf8', shell: true },
    );
    const matched = !listCheck.error && listCheck.status === 0 && (listCheck.stdout || '').trim().length > 0;
    if (!matched) {
      process.stderr.write(
        'test:since: TEST_SINCE_ZERO_SELECTION: reason=no-spec-matched — '
          + `the diff since "${ref}" is non-empty but the import graph routed none of it to a\n`
          + 'spec. This is commonly a legitimate docs/config/fs-read-only change (the import\n'
          + 'graph cannot see those) rather than a broken selection, so this is NOT treated as\n'
          + 'a failure here — but the result below must not be read as "everything relevant\n'
          + 'was tested": confirm coverage via `npm test` (the fs-read sensors: parity,\n'
          + 'live-state, doc-locks) and any affected e2e specs named at hand-off before\n'
          + 'treating this ticket as verified.\n',
      );
    }
  } else {
    process.stderr.write(
      'test:since: TEST_SINCE_ZERO_SELECTION: reason=empty-diff — no changed files since '
        + `"${ref}"\n(committed diff + staged + unstaged are all empty) — a zero-spec result below\n`
        + 'is expected here, not a failure.\n',
    );
  }

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
