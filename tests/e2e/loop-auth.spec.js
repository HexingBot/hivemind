// tests/e2e/loop-auth.spec.js
// TASK-075 — e2e/bundle-touching tests for src/loop-auth.js
// (slow tier — real tmpdir + pointer + bundle on disk).
//
// ACs covered:
//   AC1 — setLoopAuth writes loop_auth to the active bundle atomically;
//         unknown switch name is rejected before any I/O (bundle file byte-
//         identical after a rejected call); absent bundle surfaces a clear error.
//   AC2 — grantUnattended sets the three unattended-preset switches true;
//         auto_push_after_close / auto_version_bump_on_milestone stay false
//         unless explicitly opted in via optIns.
//   AC4 — persisting the preset keeps the bundle valid against
//         state/bundle.schema.json (tests/live-state.spec.js-style check).
//   AC5 — setLoopAuth/grantUnattended do NOT touch loop_state or any other
//         bundle field besides loop_auth + updated_at (backstop ceilings
//         living in loop_state are untouched).
//
// All tests MUST FAIL until src/loop-auth.js is created.
//
// Disk I/O / tmpdir -> slow tier: tests/e2e/.

import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { REPO_ROOT } from '../helpers/repoRoot.js';

afterAll(cleanupAll);

const __thisDir = dirname(fileURLToPath(import.meta.url));
const __srcDir = join(__thisDir, '..', '..', 'src');
const LOOP_AUTH_URL = pathToFileURL(join(__srcDir, 'loop-auth.js')).href;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Write a minimal pointer + active bundle (with a populated loop_state
 * carrying backstop ceilings, mirroring the live bundle shape) under a fresh
 * temp dir. */
function makeRepo({ sessionId, bundleExtra = {}, noPointer = false, nullActiveSession = false } = {}) {
  const id = sessionId || '20260616T120000Z-testbeef';
  const root = makeTmpDir('af-la');

  mkdirSync(join(root, 'state'), { recursive: true });

  if (!noPointer) {
    writeFileSync(
      join(root, 'state', 'session.json'),
      JSON.stringify({
        schema_version: 2,
        active_session_id: nullActiveSession ? null : id,
        updated_at: '2026-06-16T12:00:00Z',
      }, null, 2),
      'utf8',
    );
  }

  if (!nullActiveSession) {
    const bundleDir = join(root, 'state', 'sessions', id);
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(
      join(bundleDir, 'session.json'),
      JSON.stringify({
        schema_version: 2,
        session_id: id,
        lifecycle_state: 'active',
        updated_at: '2026-06-16T12:00:00Z',
        active_task: 'TASK-075',
        workflow_step: 'impl',
        next_action: 'implement loop-auth',
        handoff_summary: 'in progress',
        open_questions: [],
        blockers: [],
        decisions: [],
        subagent_results: [],
        pending_human_confirmation: null,
        mode: 'loop',
        loop_state: {
          goal: { label: 'goal-loop-auth' },
          iteration: 3,
          consecutiveNoProgress: 0,
          maxIterations: 20,
          maxNoProgress: 3,
          maxReviewerRetries: 2,
        },
        ...bundleExtra,
      }, null, 2),
      'utf8',
    );
  }

  return { root, id };
}

function readBundleFile(root, id) {
  return readFileSync(join(root, 'state', 'sessions', id, 'session.json'), 'utf8');
}

// ---------------------------------------------------------------------------
// AC1 — setLoopAuth writes loop_auth to the bundle atomically.
// ---------------------------------------------------------------------------

describe('AC1 — setLoopAuth writes a single switch to the bundle', () => {
  it('setLoopAuth_persists_a_single_true_switch', async () => {
    const { setLoopAuth } = await import(LOOP_AUTH_URL);
    const { root, id } = makeRepo();

    await setLoopAuth({ repoRoot: root, grants: { auto_close_on_green_review: true } });

    const onDisk = JSON.parse(readBundleFile(root, id));
    expect(onDisk.loop_auth.auto_close_on_green_review).toBe(true);
  });

  it('setLoopAuth_merges_multiple_switches_in_one_call', async () => {
    const { setLoopAuth } = await import(LOOP_AUTH_URL);
    const { root, id } = makeRepo();

    await setLoopAuth({
      repoRoot: root,
      grants: { auto_close_on_green_review: true, auto_consolidate: true },
    });

    const onDisk = JSON.parse(readBundleFile(root, id));
    expect(onDisk.loop_auth.auto_close_on_green_review).toBe(true);
    expect(onDisk.loop_auth.auto_consolidate).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC1 — unknown switch name rejected before any I/O: bundle file must be
// byte-identical after a rejected call.
// ---------------------------------------------------------------------------

describe('AC1 — setLoopAuth rejects unknown switch names without touching the bundle', () => {
  it('setLoopAuth_unknown_switch_leaves_bundle_file_byte_identical', async () => {
    const { setLoopAuth } = await import(LOOP_AUTH_URL);
    const { root, id } = makeRepo();

    const before = readBundleFile(root, id);

    await expect(
      setLoopAuth({ repoRoot: root, grants: { not_a_real_switch: true } }),
    ).rejects.toThrow(/unknown|invalid/i);

    const after = readBundleFile(root, id);
    expect(after).toBe(before);
  });

  it('setLoopAuth_partial_unknown_key_in_multi_grant_leaves_bundle_untouched', async () => {
    const { setLoopAuth } = await import(LOOP_AUTH_URL);
    const { root, id } = makeRepo();

    const before = readBundleFile(root, id);

    await expect(
      setLoopAuth({
        repoRoot: root,
        grants: { auto_close_on_green_review: true, bogus: true },
      }),
    ).rejects.toThrow(/unknown|invalid/i);

    const after = readBundleFile(root, id);
    expect(after).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// AC1 — absent bundle surfaces a clear error.
// ---------------------------------------------------------------------------

describe('AC1 — setLoopAuth surfaces a clear error when there is no active session', () => {
  it('setLoopAuth_no_pointer_file_rejects_clearly', async () => {
    const { setLoopAuth } = await import(LOOP_AUTH_URL);
    const { root } = makeRepo({ noPointer: true });

    await expect(
      setLoopAuth({ repoRoot: root, grants: { auto_consolidate: true } }),
    ).rejects.toThrow();
  });

  it('setLoopAuth_null_active_session_id_rejects_clearly', async () => {
    const { setLoopAuth } = await import(LOOP_AUTH_URL);
    const { root } = makeRepo({ nullActiveSession: true });

    await expect(
      setLoopAuth({ repoRoot: root, grants: { auto_consolidate: true } }),
    ).rejects.toThrow(/no active session|active session/i);
  });
});

// ---------------------------------------------------------------------------
// AC2 — grantUnattended preset composition.
// ---------------------------------------------------------------------------

describe('AC2 — grantUnattended persists the unattended preset', () => {
  it('grantUnattended_sets_the_three_preset_switches_true_by_default', async () => {
    const { grantUnattended } = await import(LOOP_AUTH_URL);
    const { root, id } = makeRepo();

    await grantUnattended({ repoRoot: root });

    const onDisk = JSON.parse(readBundleFile(root, id));
    expect(onDisk.loop_auth.auto_close_on_green_review).toBe(true);
    expect(onDisk.loop_auth.uat_delegated_to_orchestrator).toBe(true);
    expect(onDisk.loop_auth.auto_consolidate).toBe(true);
  });

  it('grantUnattended_leaves_push_and_version_bump_false_without_optIns', async () => {
    const { grantUnattended } = await import(LOOP_AUTH_URL);
    const { root, id } = makeRepo();

    await grantUnattended({ repoRoot: root });

    const onDisk = JSON.parse(readBundleFile(root, id));
    expect(onDisk.loop_auth.auto_push_after_close).toBe(false);
    expect(onDisk.loop_auth.auto_version_bump_on_milestone).toBe(false);
  });

  it('grantUnattended_honors_explicit_optIns_for_push_and_version_bump', async () => {
    const { grantUnattended } = await import(LOOP_AUTH_URL);
    const { root, id } = makeRepo();

    await grantUnattended({
      repoRoot: root,
      optIns: { auto_push_after_close: true, auto_version_bump_on_milestone: true },
    });

    const onDisk = JSON.parse(readBundleFile(root, id));
    expect(onDisk.loop_auth.auto_push_after_close).toBe(true);
    expect(onDisk.loop_auth.auto_version_bump_on_milestone).toBe(true);
    // Preset switches remain true alongside the opt-ins.
    expect(onDisk.loop_auth.auto_close_on_green_review).toBe(true);
    expect(onDisk.loop_auth.uat_delegated_to_orchestrator).toBe(true);
    expect(onDisk.loop_auth.auto_consolidate).toBe(true);
  });

  it('grantUnattended_rejects_unknown_optIn_and_leaves_bundle_untouched', async () => {
    const { grantUnattended } = await import(LOOP_AUTH_URL);
    const { root, id } = makeRepo();
    const before = readBundleFile(root, id);

    await expect(
      grantUnattended({ repoRoot: root, optIns: { not_a_real_switch: true } }),
    ).rejects.toThrow(/unknown|invalid/i);

    const after = readBundleFile(root, id);
    expect(after).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// AC4 — persisted bundle stays valid against state/bundle.schema.json.
// ---------------------------------------------------------------------------

describe('AC4 — bundle stays schema-valid after the unattended preset is persisted', () => {
  it('grantUnattended_result_validates_against_bundle_schema_json', async () => {
    const { grantUnattended } = await import(LOOP_AUTH_URL);
    const { root, id } = makeRepo();

    await grantUnattended({ repoRoot: root });

    const onDisk = JSON.parse(readBundleFile(root, id));
    const schemaPath = join(REPO_ROOT, 'state', 'bundle.schema.json');
    expect(existsSync(schemaPath), 'state/bundle.schema.json must exist').toBe(true);
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));

    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const ok = validate(onDisk);
    expect(ok, 'persisted bundle failed schema: ' + JSON.stringify(validate.errors, null, 2)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC5 — backstop ceilings / other bundle fields are untouched.
// ---------------------------------------------------------------------------

describe('AC5 — setLoopAuth/grantUnattended only touch loop_auth and updated_at', () => {
  it('setLoopAuth_does_not_modify_loop_state_backstop_ceilings', async () => {
    const { setLoopAuth } = await import(LOOP_AUTH_URL);
    const { root, id } = makeRepo();
    const before = JSON.parse(readBundleFile(root, id));

    await setLoopAuth({ repoRoot: root, grants: { auto_consolidate: true } });

    const after = JSON.parse(readBundleFile(root, id));
    expect(after.loop_state).toEqual(before.loop_state);
    expect(after.loop_state.maxIterations).toBe(20);
    expect(after.loop_state.maxNoProgress).toBe(3);
    expect(after.loop_state.maxReviewerRetries).toBe(2);
  });

  it('grantUnattended_does_not_modify_any_bundle_field_other_than_loop_auth_and_updated_at', async () => {
    const { grantUnattended } = await import(LOOP_AUTH_URL);
    const { root, id } = makeRepo();
    const before = JSON.parse(readBundleFile(root, id));

    await grantUnattended({ repoRoot: root });

    const after = JSON.parse(readBundleFile(root, id));
    const beforeRest = { ...before };
    const afterRest = { ...after };
    delete beforeRest.loop_auth;
    delete afterRest.loop_auth;
    delete beforeRest.updated_at;
    delete afterRest.updated_at;

    expect(afterRest).toEqual(beforeRest);
  });
});
