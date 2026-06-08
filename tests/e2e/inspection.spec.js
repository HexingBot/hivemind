// tests/inspection.spec.js
// AC7 — session.list and session.show are read-only inspection commands.
//
// Maps research §H:
//   #15 session_list_lists_all_bundles
//   #16 session_show_prints_without_mutating

import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  PROD, makeSessionId, seedActiveBundle, seedBundleInState, bundlePath, makeRepoSkeleton, pointerPath,
} from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

describe('AC7 — session.list', () => {
  it('session_list_lists_all_bundles', async () => {
    const { listSessions } = await import(PROD.inspection);

    const repoDir = makeTmpDir('af-list');
    makeRepoSkeleton(repoDir, {
      pointer: { schema_version: 2, active_session_id: null, updated_at: '2026-05-24T12:00:00Z' },
    });
    // Three bundles with distinct created_at values.
    const ids = [
      '20260522T100000Z-aaaaaaaa',
      '20260523T100000Z-bbbbbbbb',
      '20260524T100000Z-cccccccc',
    ];
    seedActiveBundle(bundlePath(repoDir, ids[0]),
      { session_id: ids[0], created_at: '2026-05-22T10:00:00Z' });
    seedBundleInState(bundlePath(repoDir, ids[1]), 'paused',
      { session_id: ids[1], created_at: '2026-05-23T10:00:00Z' });
    seedBundleInState(bundlePath(repoDir, ids[2]), 'ended',
      { session_id: ids[2], created_at: '2026-05-24T10:00:00Z' });

    const rows = await listSessions({ repoRoot: repoDir });

    expect(rows).toHaveLength(3);
    // Newest-first order.
    expect(rows.map((r) => r.id)).toEqual([ids[2], ids[1], ids[0]]);
    // Required columns per research §E.
    for (const r of rows) {
      expect(r).toHaveProperty('id');
      expect(r).toHaveProperty('created_at');
      expect(r).toHaveProperty('lifecycle_state');
      expect(r).toHaveProperty('active_task');
      expect(r).toHaveProperty('workflow_step');
    }
    expect(rows[0].lifecycle_state).toBe('ended');
    expect(rows[1].lifecycle_state).toBe('paused');
    expect(rows[2].lifecycle_state).toBe('active');
  });
});

describe('AC7 — session.show is read-only', () => {
  it('session_show_prints_without_mutating', async () => {
    const { showSession } = await import(PROD.inspection);

    const repoDir = makeTmpDir('af-show');
    // Active session A.
    const idA = '20260524T150000Z-11111111';
    seedActiveBundle(bundlePath(repoDir, idA), { session_id: idA });
    // Other bundle B (ended) — what session.show targets.
    const idB = '20260523T150000Z-22222222';
    seedBundleInState(bundlePath(repoDir, idB), 'ended', { session_id: idB });
    makeRepoSkeleton(repoDir, {
      pointer: { schema_version: 2, active_session_id: idA, updated_at: '2026-05-24T15:00:00Z' },
    });

    const ptrBefore = readFileSync(pointerPath(repoDir), 'utf8');
    const ptrBeforeMtime = statSync(pointerPath(repoDir)).mtimeMs;
    const aBefore = readFileSync(join(bundlePath(repoDir, idA), 'session.json'), 'utf8');
    const aBeforeMtime = statSync(join(bundlePath(repoDir, idA), 'session.json')).mtimeMs;
    const bBefore = readFileSync(join(bundlePath(repoDir, idB), 'session.json'), 'utf8');
    const bBeforeMtime = statSync(join(bundlePath(repoDir, idB), 'session.json')).mtimeMs;

    const result = await showSession({ repoRoot: repoDir, id: idB });

    // The result includes parsed session.json and summary.md text.
    expect(result).toHaveProperty('session_json');
    expect(result).toHaveProperty('summary_md');
    expect(result.session_json.session_id).toBe(idB);
    expect(result.summary_md).toMatch(/^# Session /);

    // Nothing mutated.
    expect(readFileSync(pointerPath(repoDir), 'utf8')).toBe(ptrBefore);
    expect(statSync(pointerPath(repoDir)).mtimeMs).toBe(ptrBeforeMtime);
    expect(readFileSync(join(bundlePath(repoDir, idA), 'session.json'), 'utf8')).toBe(aBefore);
    expect(statSync(join(bundlePath(repoDir, idA), 'session.json')).mtimeMs).toBe(aBeforeMtime);
    expect(readFileSync(join(bundlePath(repoDir, idB), 'session.json'), 'utf8')).toBe(bBefore);
    expect(statSync(join(bundlePath(repoDir, idB), 'session.json')).mtimeMs).toBe(bBeforeMtime);
  });
});
