// tests/e2e/operating-mode.spec.js
// TASK-063 — e2e/bundle-touching tests for src/operating-mode.js
// (slow tier — real tmpdir + pointer + bundle on disk).
//
// ACs covered:
//   AC1 — default mode is 'harness'; absent-bundle / absent-`mode` backward-compat.
//   AC2 — getMode reads bundle and returns current mode; setMode writes mode atomically;
//          setMode is idempotent (calling with same value succeeds without error).
//   AC3/AC4 — setMode supports flip outside the loop (harness→loop, loop→harness).
//
// All tests MUST FAIL until src/operating-mode.js is created.
//
// Disk I/O / tmpdir → slow tier: tests/e2e/.

import { describe, it, expect, afterAll } from 'vitest';
import {
  mkdirSync, writeFileSync, readFileSync, symlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

// ---------------------------------------------------------------------------
// Resolve the production module via file URL — same pattern as session-lock.spec.js.
// ---------------------------------------------------------------------------
const __thisDir = dirname(fileURLToPath(import.meta.url));
const __srcDir = join(__thisDir, '..', '..', 'src');
const OPERATING_MODE_URL = pathToFileURL(join(__srcDir, 'operating-mode.js')).href;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Write a minimal pointer + active bundle under a fresh temp dir. */
function makeRepo({ sessionId, bundleExtra = {}, missingBundleDir = false } = {}) {
  const id = sessionId || '20260616T120000Z-deadbeef';
  const root = makeTmpDir('af-om');

  // Pointer
  mkdirSync(join(root, 'state'), { recursive: true });
  writeFileSync(
    join(root, 'state', 'session.json'),
    JSON.stringify({
      schema_version: 2,
      active_session_id: id,
      updated_at: '2026-06-16T12:00:00Z',
    }, null, 2),
    'utf8',
  );

  // missingBundleDir (TASK-092 AC2, mirrors TASK-088 AC2 in loop-auth): pointer
  // names a real session id, but no bundle directory/session.json exists at all.
  if (missingBundleDir) {
    return { root, id };
  }

  // Bundle
  const bundleDir = join(root, 'state', 'sessions', id);
  mkdirSync(bundleDir, { recursive: true });
  writeFileSync(
    join(bundleDir, 'session.json'),
    JSON.stringify({
      schema_version: 2,
      session_id: id,
      lifecycle_state: 'active',
      updated_at: '2026-06-16T12:00:00Z',
      active_task: 'TASK-063',
      // TASK-103 — was 'implement' (not a valid workflow_step enum value;
      // the schema only allows 'impl'). Invisible before TASK-103 added
      // validate-before-write to writeBundleSession (AC1); setMode's merge
      // + write now surfaces it as a real E_BUNDLE_INVALID.
      workflow_step: 'impl',
      next_action: 'write tests',
      handoff_summary: 'in progress',
      open_questions: [],
      blockers: [],
      decisions: [],
      subagent_results: [],
      pending_human_confirmation: null,
      ...bundleExtra,
    }, null, 2),
    'utf8',
  );

  return { root, id };
}

// ---------------------------------------------------------------------------
// AC1 + AC2 — getMode returns 'harness' when bundle has no `mode` field (backward-compat)
// ---------------------------------------------------------------------------

describe('AC1 — getMode defaults to harness when bundle has no mode field', () => {
  it('getMode_returns_harness_for_legacy_bundle_without_mode', async () => {
    const { getMode } = await import(OPERATING_MODE_URL);
    const { root } = makeRepo(); // bundle has no `mode` field
    const result = await getMode({ repoRoot: root });
    expect(result).toBe('harness');
  });
});

// ---------------------------------------------------------------------------
// AC2 — getMode returns existing mode when bundle already has one
// ---------------------------------------------------------------------------

describe('AC2 — getMode reads mode from bundle', () => {
  it('getMode_returns_loop_when_bundle_mode_is_loop', async () => {
    const { getMode } = await import(OPERATING_MODE_URL);
    const { root } = makeRepo({ bundleExtra: { mode: 'loop' } });
    const result = await getMode({ repoRoot: root });
    expect(result).toBe('loop');
  });

  it('getMode_returns_harness_when_bundle_mode_is_harness', async () => {
    const { getMode } = await import(OPERATING_MODE_URL);
    const { root } = makeRepo({ bundleExtra: { mode: 'harness' } });
    const result = await getMode({ repoRoot: root });
    expect(result).toBe('harness');
  });
});

// ---------------------------------------------------------------------------
// AC2 + AC4 — setMode writes mode to bundle atomically (harness→loop flip)
// ---------------------------------------------------------------------------

describe('AC2/AC4 — setMode writes mode to bundle (harness→loop)', () => {
  it('setMode_flips_mode_to_loop_and_persists', async () => {
    const { setMode, getMode } = await import(OPERATING_MODE_URL);
    const { root, id } = makeRepo(); // starts with no mode (defaults harness)

    await setMode({ repoRoot: root, mode: 'loop' });

    // Verify via getMode.
    const result = await getMode({ repoRoot: root });
    expect(result).toBe('loop');

    // Verify the bundle file was actually updated on disk.
    const bundlePath = join(root, 'state', 'sessions', id, 'session.json');
    const onDisk = JSON.parse(readFileSync(bundlePath, 'utf8'));
    expect(onDisk.mode).toBe('loop');
  });
});

// ---------------------------------------------------------------------------
// AC2 + AC4 — setMode writes mode (loop→harness flip)
// ---------------------------------------------------------------------------

describe('AC2/AC4 — setMode writes mode to bundle (loop→harness)', () => {
  it('setMode_flips_mode_back_to_harness', async () => {
    const { setMode, getMode } = await import(OPERATING_MODE_URL);
    const { root } = makeRepo({ bundleExtra: { mode: 'loop' } });

    await setMode({ repoRoot: root, mode: 'harness' });

    const result = await getMode({ repoRoot: root });
    expect(result).toBe('harness');
  });
});

// ---------------------------------------------------------------------------
// AC2 — setMode is idempotent (same value twice must not throw)
// ---------------------------------------------------------------------------

describe('AC2 — setMode idempotency', () => {
  it('setMode_called_twice_with_same_value_does_not_throw', async () => {
    const { setMode, getMode } = await import(OPERATING_MODE_URL);
    const { root } = makeRepo();

    await expect(setMode({ repoRoot: root, mode: 'loop' })).resolves.not.toThrow();
    await expect(setMode({ repoRoot: root, mode: 'loop' })).resolves.not.toThrow();

    // Mode must remain 'loop' after two identical sets.
    const result = await getMode({ repoRoot: root });
    expect(result).toBe('loop');
  });

  it('setMode_harness_on_harness_does_not_throw', async () => {
    const { setMode } = await import(OPERATING_MODE_URL);
    const { root } = makeRepo({ bundleExtra: { mode: 'harness' } });

    await expect(setMode({ repoRoot: root, mode: 'harness' })).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// TASK-092 AC2 — the pointer names a session whose bundle directory is
// missing (deleted or moved out from under it). Before the fix this surfaced
// a raw ENOENT from readBundleSession (via the shared bundle.js helper); the
// tailored error must name the session id, the expected session.json path,
// and the calling function ('setMode') for symptom attribution.
//
// TASK-236 (WG-H-010, wargaming 2026-09-16, CU6) — the getMode test right
// below THIS comment used to assert the opposite of what CU6 requires:
// "getMode_still_defaults_to_harness_when_bundle_dir_is_missing_unmodified_
// behavior" locked in the exact silent-degradation defect the ticket fixes
// (a ghost pointer — active_session_id names a session with no bundle on
// disk — read as legitimate 'harness' instead of a named error). TASK-092's
// own comment flagged this as "deliberately NOT covered ... out of scope for
// this migration" — TASK-236 is what brings it into scope. This is a
// ticket-mandated correction of a stale anchor, not a silent edit: the old
// assertion is deleted because CU6 (human-approved, see tasks/TASK-236.json)
// requires the opposite, and this is the exact test that reproduced the
// approved-list conflict.
// ---------------------------------------------------------------------------

describe('TASK-092 AC2 — setMode tailors the missing-bundle-dir error', () => {
  it('setMode_missing_bundle_dir_throws_typed_error_with_session_id_and_path', async () => {
    const { setMode } = await import(OPERATING_MODE_URL);
    const { root, id } = makeRepo({ missingBundleDir: true });

    let caughtErr;
    try {
      await setMode({ repoRoot: root, mode: 'loop' });
    } catch (err) {
      caughtErr = err;
    }

    expect(caughtErr, 'setMode must reject when the bundle dir is missing').toBeDefined();
    expect(caughtErr.code, 'must be the tailored code, not a raw ENOENT').toBe('E_BUNDLE_MISSING');
    expect(caughtErr.code).not.toBe('ENOENT');
    expect(caughtErr.message).toContain(id);
    expect(caughtErr.message).toContain(join(root, 'state', 'sessions', id, 'session.json'));
    expect(caughtErr.message).toContain('setMode');
  });

  // TASK-236 CU6 (WG-H-010) — replaces the retired
  // "getMode_still_defaults_to_harness_when_bundle_dir_is_missing_unmodified_
  // behavior" test above (see the block comment). Harm prevented: a ghost
  // pointer (active_session_id naming a session with no bundle directory —
  // e.g. after a partial delete or a botched migration) must never read back
  // as ordinary 'harness' idle state; that silent read is exactly what let a
  // corrupted/incomplete state file disable the loop-mode close guard.
  it('getMode_throws_a_named_ModeStateError_when_the_pointer_names_a_missing_bundle_dir', async () => {
    const { getMode, ModeStateError } = await import(OPERATING_MODE_URL);
    const { root, id } = makeRepo({ missingBundleDir: true });

    let caughtErr;
    try {
      await getMode({ repoRoot: root });
    } catch (err) {
      caughtErr = err;
    }

    expect(caughtErr, 'getMode must reject on a ghost pointer, never resolve to harness').toBeDefined();
    expect(caughtErr).toBeInstanceOf(ModeStateError);
    expect(caughtErr.code).toBe('E_MODE_BUNDLE_MISSING');
    expect(caughtErr.message).toContain(id);
  });
});

// ---------------------------------------------------------------------------
// TASK-236 CU3 (WG-H-007) — getMode over a truncated / invalid-JSON bundle
// must distinguish "the state exists and is corrupt" from the legitimate
// "no mode declared" harness default (AC1). Harm prevented: a truncated
// bundle.session.json (e.g. a crash mid-write, or a corrupted disk) reading
// back as ordinary harness is the exact defect that let corrupting a state
// file silently disable src/close-guard.js's loop-mode close guard.
// ---------------------------------------------------------------------------
describe('TASK-236 CU3 — getMode distinguishes a corrupt bundle from a legitimate default', () => {
  it('getMode_throws_a_named_ModeStateError_when_the_bundle_json_is_truncated', async () => {
    const { getMode, ModeStateError } = await import(OPERATING_MODE_URL);
    const { root, id } = makeRepo({ bundleExtra: { mode: 'loop' } });

    // Truncate the bundle's session.json to simulate a half-written file.
    const bundlePath = join(root, 'state', 'sessions', id, 'session.json');
    const full = readFileSync(bundlePath, 'utf8');
    writeFileSync(bundlePath, full.slice(0, Math.floor(full.length / 2)), 'utf8');

    let caughtErr;
    try {
      await getMode({ repoRoot: root });
    } catch (err) {
      caughtErr = err;
    }

    expect(caughtErr, 'getMode must reject on truncated JSON, never resolve to harness').toBeDefined();
    expect(caughtErr).toBeInstanceOf(ModeStateError);
    expect(caughtErr.code).toBe('E_MODE_BUNDLE_CORRUPT');
  });
});

// ---------------------------------------------------------------------------
// TASK-236 CU7 (WG-H-010) — the pointer's schema_version is not validated
// today, so an unrecognized value passes through silently. Harm prevented: a
// pointer written by a future/incompatible schema version (or corrupted to
// carry a bogus value) must be reported with a named error rather than have
// its stale/unknown shape trusted and acted on as if it were the current
// contract.
// ---------------------------------------------------------------------------
describe('TASK-236 CU7 — getMode rejects an unrecognized pointer schema_version', () => {
  it('getMode_throws_a_named_ModeStateError_when_pointer_schema_version_is_unrecognized', async () => {
    const { getMode, ModeStateError } = await import(OPERATING_MODE_URL);
    const { root, id } = makeRepo({ bundleExtra: { mode: 'loop' } });

    const pointerPath = join(root, 'state', 'session.json');
    writeFileSync(
      pointerPath,
      JSON.stringify({ schema_version: 999, active_session_id: id, updated_at: '2026-09-16T12:00:00Z' }, null, 2),
      'utf8',
    );

    let caughtErr;
    try {
      await getMode({ repoRoot: root });
    } catch (err) {
      caughtErr = err;
    }

    expect(caughtErr, 'getMode must reject an unrecognized schema_version, never trust it silently').toBeDefined();
    expect(caughtErr).toBeInstanceOf(ModeStateError);
    expect(caughtErr.code).toBe('E_MODE_POINTER_INVALID');
  });
});

// ---------------------------------------------------------------------------
// TASK-236 review MEDIUM-1 (2026-09-17) — a bundle that IS valid JSON and
// DOES declare a `mode` field, but with a value outside OPERATING_MODES
// (e.g. 'loop' byte-corrupted in place to 'lo0p'), used to silently return
// 'harness' — the same silent-degradation shape CU3/CU7 already close for a
// corrupt bundle / unrecognized schema_version, left open for a declared-
// but-garbage mode value. Harm prevented: this collapsed "no mode declared"
// (legitimate idle state, CU5) and "mode declared but garbage" into one
// indistinguishable 'harness' outcome, which is the same failure shape that
// let a corrupted state file silently disable the loop-mode close guard.
// ---------------------------------------------------------------------------
describe('TASK-236 review MEDIUM-1 — getMode rejects a declared-but-unrecognized mode value', () => {
  it('getMode_throws_a_named_ModeStateError_when_bundle_mode_is_an_unrecognized_value', async () => {
    const { getMode, ModeStateError } = await import(OPERATING_MODE_URL);
    const { root } = makeRepo({ bundleExtra: { mode: 'lo0p' } });

    let caughtErr;
    try {
      await getMode({ repoRoot: root });
    } catch (err) {
      caughtErr = err;
    }

    expect(caughtErr, 'getMode must reject an unrecognized declared mode, never fall back to harness').toBeDefined();
    expect(caughtErr).toBeInstanceOf(ModeStateError);
    expect(caughtErr.code).toBe('E_MODE_BUNDLE_INVALID');
  });

  it('getMode_still_returns_harness_when_the_bundle_declares_no_mode_field_at_all', async () => {
    // CRITICAL negative case (CU5, cold start): confirms the MEDIUM-1 fix
    // did not regress the legitimate "no mode declared" default.
    const { getMode } = await import(OPERATING_MODE_URL);
    const { root } = makeRepo(); // bundle has no `mode` field
    const result = await getMode({ repoRoot: root });
    expect(result).toBe('harness');
  });
});

// ---------------------------------------------------------------------------
// TASK-236 wargaming fix-round WG-1 (2026-09-17) — getMode validated the
// `mode` VALUE but never the SHAPE of the containers it reads. Four
// surviving fail-open vectors, reproduced by the adversary end-to-end
// against the pre-fix code (each returned plain 'harness', byte-identical
// to a repo with no state/ at all, while the equivalent sane loop bundle
// correctly denied the close): a pointer that parses to a non-object
// (array/scalar), a dangling symlink at state/session.json, an
// active_session_id shaped as a path-traversal attempt, and a bundle that
// parses to a non-object. Each lock below names the harm it prevents and
// was proved red by temporarily reverting its corresponding check in
// src/operating-mode.js (see the hand-off for the exact revert/restore
// steps) before being restored and left green here.
// ---------------------------------------------------------------------------
describe('TASK-236 WG-1 — getMode validates container SHAPE, not just the mode value', () => {
  it('getMode_throws_when_the_pointer_parses_to_a_JSON_array', async () => {
    // Harm prevented: a pointer file corrupted/replaced with a JSON array
    // (still truthy, still lacks .active_session_id) used to satisfy the
    // `!pointer || pointer.active_session_id == null` short-circuit and
    // read back as ordinary idle harness — silently disabling the loop-mode
    // close guard exactly like every other vector in this block.
    const { getMode, ModeStateError } = await import(OPERATING_MODE_URL);
    const tmp = makeTmpDir('af-om-wg1');
    mkdirSync(join(tmp, 'state'), { recursive: true });
    writeFileSync(join(tmp, 'state', 'session.json'), '[]', 'utf8');
    let caughtErr;
    try {
      await getMode({ repoRoot: tmp });
    } catch (err) {
      caughtErr = err;
    }
    expect(caughtErr, 'getMode must reject a pointer that parses to a non-object, never fall back to harness').toBeDefined();
    expect(caughtErr).toBeInstanceOf(ModeStateError);
    expect(caughtErr.code).toBe('E_MODE_POINTER_INVALID');
  });

  it('getMode_throws_when_state_session_json_is_a_dangling_symlink', async () => {
    // Harm prevented: existsSync (used by src/pointer.js's readPointer)
    // FOLLOWS symlinks and reports `false` for a broken one, so a dangling
    // symlink at state/session.json read back identically to "no pointer
    // file at all" — idle, not corrupt.
    const { getMode, ModeStateError } = await import(OPERATING_MODE_URL);
    const r = makeTmpDir('af-om-wg1');
    mkdirSync(join(r, 'state'), { recursive: true });
    symlinkSync(join(r, 'state', 'nonexistent-target.json'), join(r, 'state', 'session.json'));
    let caughtErr;
    try {
      await getMode({ repoRoot: r });
    } catch (err) {
      caughtErr = err;
    }
    expect(caughtErr, 'getMode must reject a dangling symlink, never fall back to harness').toBeDefined();
    expect(caughtErr).toBeInstanceOf(ModeStateError);
    expect(caughtErr.code).toBe('E_MODE_POINTER_CORRUPT');
  });

  it('getMode_throws_when_active_session_id_is_a_path_traversal_attempt', async () => {
    // Harm prevented: an unvalidated active_session_id joined straight into
    // a filesystem path let '..' re-read state/session.json ITSELF as the
    // "bundle", and a deeper '../../../../../../tmp/x' escape an arbitrary
    // file outside the repo and have this function honor ITS `mode` —
    // turning a denied close into a permitted one based on attacker- or
    // accident-controlled content entirely outside state/.
    const { getMode, ModeStateError } = await import(OPERATING_MODE_URL);
    const { root } = makeRepo();
    writeFileSync(
      join(root, 'state', 'session.json'),
      JSON.stringify({ schema_version: 2, active_session_id: '..', updated_at: '2026-09-17T00:00:00Z' }),
      'utf8',
    );
    let caughtErr;
    try {
      await getMode({ repoRoot: root });
    } catch (err) {
      caughtErr = err;
    }
    expect(caughtErr, 'getMode must reject a malformed active_session_id, never join it into a path').toBeDefined();
    expect(caughtErr).toBeInstanceOf(ModeStateError);
    expect(caughtErr.code).toBe('E_MODE_POINTER_INVALID');
  });

  it('getMode_throws_when_the_bundle_session_json_parses_to_a_scalar', async () => {
    // Harm prevented (also closes WG-2, the unnamed TypeError on a `null`
    // bundle): a bundle that parses to a scalar/array/null used to have its
    // `.mode` field read off silently — property access on a primitive or
    // array never throws, so `bundle.mode` was simply `undefined` and this
    // fell through to the legitimate-harness return, or (for JSON `null`)
    // threw a bare, uncoded TypeError indistinguishable from a programming
    // bug.
    const { getMode, ModeStateError } = await import(OPERATING_MODE_URL);
    const { root, id } = makeRepo();
    writeFileSync(join(root, 'state', 'sessions', id, 'session.json'), '42', 'utf8');
    let caughtErr;
    try {
      await getMode({ repoRoot: root });
    } catch (err) {
      caughtErr = err;
    }
    expect(caughtErr, 'getMode must reject a non-object bundle, never fall back to harness').toBeDefined();
    expect(caughtErr).toBeInstanceOf(ModeStateError);
    expect(caughtErr.code).toBe('E_MODE_BUNDLE_CORRUPT');

    // WG-2 specifically: a bundle that parses to JSON `null` must be the
    // SAME named error, never a bare TypeError.
    writeFileSync(join(root, 'state', 'sessions', id, 'session.json'), 'null', 'utf8');
    let nullErr;
    try {
      await getMode({ repoRoot: root });
    } catch (err) {
      nullErr = err;
    }
    expect(nullErr).toBeInstanceOf(ModeStateError);
    expect(nullErr.code).toBe('E_MODE_BUNDLE_CORRUPT');
  });

  it('getMode_still_resolves_correctly_through_a_BOM_prefixed_pointer_file (WG-4)', async () => {
    // Harm prevented: a leading UTF-8 BOM — something ordinary editors
    // produce — is not valid JSON syntax on its own and, once pointer/bundle
    // shape validation exists, would otherwise be indistinguishable from
    // truncated JSON and hard-block EVERY close in a repo that has never
    // touched loop mode. Stripping it keeps a benign editor artifact from
    // becoming an availability regression.
    const { getMode } = await import(OPERATING_MODE_URL);
    const { root, id } = makeRepo({ bundleExtra: { mode: 'loop' } });
    const pointerPath = join(root, 'state', 'session.json');
    const withBom = '﻿' + JSON.stringify({
      schema_version: 2, active_session_id: id, updated_at: '2026-09-17T00:00:00Z',
    });
    writeFileSync(pointerPath, withBom, 'utf8');
    const result = await getMode({ repoRoot: root });
    expect(result).toBe('loop');
  });

  // ---------------------------------------------------------------------------
  // TASK-236 MEDIO-1 (WG-3 fix-round, 2026-09-17) — the sibling of WG-4 above:
  // a BOM-prefixed BUNDLE, not only a BOM-prefixed pointer. Harm prevented:
  // before this fix, stripBom was applied only in readPointerForMode; a
  // BOM-prefixed bundle.session.json (an ordinary editor artifact, same class
  // as WG-4) hit JSON.parse directly via readBundleSession and was
  // indistinguishable from truncated JSON, hard-blocking every close in a
  // repo whose bundle happened to carry one — an availability regression for
  // a benign file, not an attack.
  // ---------------------------------------------------------------------------
  it('getMode_still_resolves_correctly_through_a_BOM_prefixed_bundle_file (MEDIO-1)', async () => {
    const { getMode } = await import(OPERATING_MODE_URL);
    const { root, id } = makeRepo({ bundleExtra: { mode: 'loop' } });
    const bundlePath = join(root, 'state', 'sessions', id, 'session.json');
    const original = JSON.parse(readFileSync(bundlePath, 'utf8'));
    writeFileSync(bundlePath, '﻿' + JSON.stringify(original), 'utf8');
    const result = await getMode({ repoRoot: root });
    expect(result).toBe('loop');
  });
});

// ---------------------------------------------------------------------------
// TASK-236 WG-3 (third wargaming pass, 2026-09-17, finding WG3-236-001) — the
// WG-1 defense-in-depth resolved BOTH the bundle file and sessionsDir() via
// realpathSync and compared the two resolved paths. That comparison is blind
// to a symlink AT or ABOVE state/sessions/ itself: if the CONTAINER is the
// symlink, both sides resolve through it and agree. These two locks pin the
// adversary's exact reproduction — one for state/sessions/ symlinked, one for
// state/ entire symlinked — proving getMode now denies (throws) instead of
// silently reading and honoring an external file's declared mode.
// ---------------------------------------------------------------------------
describe('TASK-236 WG-3 — getMode denies when the CONTAINER (not the value) is a symlink escaping the repo', () => {
  it('getMode_throws_when_state_sessions_itself_is_a_symlink_to_an_external_directory', async () => {
    // Harm prevented: symlinking only state/sessions/ (leaving state/ and
    // state/session.json real, local files) used to be enough to make
    // getMode read and return an EXTERNAL file's declared `mode` — here
    // 'loop' — as if it were this repo's own idle/loop state, because
    // realpathSync(bundleFile) and realpathSync(sessionsDir) both resolved
    // through the same symlink and agreed on containment.
    const { getMode, ModeStateError } = await import(OPERATING_MODE_URL);
    const id = '20260917T000000Z-c0ffee00';

    const victim = makeTmpDir('af-om-wg3-sessions');
    mkdirSync(join(victim, 'state'), { recursive: true });
    writeFileSync(
      join(victim, 'state', 'session.json'),
      JSON.stringify({ schema_version: 2, active_session_id: id, updated_at: '2026-09-17T00:00:00Z' }),
      'utf8',
    );

    const external = makeTmpDir('af-om-wg3-ext-sessions');
    mkdirSync(join(external, id), { recursive: true });
    writeFileSync(
      join(external, id, 'session.json'),
      JSON.stringify({
        schema_version: 2, session_id: id, mode: 'loop', updated_at: '2026-09-17T00:00:00Z',
      }),
      'utf8',
    );

    // state/sessions -> external (a directory OUTSIDE the repo).
    symlinkSync(external, join(victim, 'state', 'sessions'));

    let caughtErr;
    try {
      await getMode({ repoRoot: victim });
    } catch (err) {
      caughtErr = err;
    }
    expect(
      caughtErr,
      'getMode must reject a symlinked state/sessions/, never read the external mode as if it were harness or loop',
    ).toBeDefined();
    expect(caughtErr).toBeInstanceOf(ModeStateError);
    expect(caughtErr.code).toBe('E_MODE_BUNDLE_CORRUPT');
  });

  it('getMode_throws_when_state_itself_is_a_symlink_to_an_external_directory', async () => {
    // Harm prevented: symlinking state/ ENTIRE (pointer and bundle both then
    // resolve through it) used to make getMode return whatever the external
    // location declared — here 'harness' — silently, exactly the same as a
    // legitimate idle repo with no local state/ at all.
    const { getMode, ModeStateError } = await import(OPERATING_MODE_URL);
    const id = '20260917T000000Z-dadfeed0';

    const victim = makeTmpDir('af-om-wg3-state');

    const external = makeTmpDir('af-om-wg3-ext-state');
    writeFileSync(
      join(external, 'session.json'),
      JSON.stringify({ schema_version: 2, active_session_id: id, updated_at: '2026-09-17T00:00:00Z' }),
      'utf8',
    );
    mkdirSync(join(external, 'sessions', id), { recursive: true });
    writeFileSync(
      join(external, 'sessions', id, 'session.json'),
      JSON.stringify({
        schema_version: 2, session_id: id, mode: 'harness', updated_at: '2026-09-17T00:00:00Z',
      }),
      'utf8',
    );

    // state -> external (a directory OUTSIDE the repo) — no local state/ dir at all.
    symlinkSync(external, join(victim, 'state'));

    let caughtErr;
    try {
      await getMode({ repoRoot: victim });
    } catch (err) {
      caughtErr = err;
    }
    expect(
      caughtErr,
      'getMode must reject a symlinked state/, never silently resolve to the external file\'s harness/loop declaration',
    ).toBeDefined();
    expect(caughtErr).toBeInstanceOf(ModeStateError);
    expect(caughtErr.code).toBe('E_MODE_BUNDLE_CORRUPT');
  });
});
