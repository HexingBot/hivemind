// tests/bundle-shape.spec.js
// AC2: bundle directory self-contained.
// AC3: Claude Code's native transcripts are not modified; snapshot is opt-in.
//
// Maps research §H:
//   #3 bundle_is_self_contained_after_copy
//   #4 claude_code_transcripts_not_modified
//   #5 transcript_snapshot_present_when_opted_in

import { describe, it, expect, afterAll } from 'vitest';
import {
  cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, statSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import {
  PROD, makeSessionId, seedActiveBundle, bundlePath, pointerPath, makeRepoSkeleton,
} from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { REPO_ROOT } from '../helpers/repoRoot.js';

afterAll(cleanupAll);

describe('AC2 — bundle is self-contained', () => {
  it('bundle_is_self_contained_after_copy', async () => {
    const { resumeFromPointer } = await import(PROD.lifecycle);

    // GIVEN: repoA with a seeded active bundle and a pointer naming it.
    const repoA = makeTmpDir('af-repoA');
    const id = makeSessionId(1);
    const bundleA = bundlePath(repoA, id);
    seedActiveBundle(bundleA, { session_id: id });
    makeRepoSkeleton(repoA, {
      pointer: { schema_version: 2, active_session_id: id, updated_at: '2026-05-24T12:00:00Z' },
      tasks: { 'TASK-004': { key: 'TASK-004', title: 'Portable session bundles', status: 'todo' } },
    });

    // WHEN: copy ONLY the bundle directory to repoB and write a pointer at repoB.
    const repoB = makeTmpDir('af-repoB');
    makeRepoSkeleton(repoB, {
      pointer: { schema_version: 2, active_session_id: id, updated_at: '2026-05-24T12:00:00Z' },
      tasks: { 'TASK-004': { key: 'TASK-004', title: 'Portable session bundles', status: 'todo' } },
    });
    cpSync(bundleA, bundlePath(repoB, id), { recursive: true });

    // THEN: resume from repoB succeeds and returns the same handoff payload.
    const payload = await resumeFromPointer({ repoRoot: repoB });
    expect(payload.handoff_summary).toBe('session was just started');
    expect(payload.active_task).toBe('TASK-004');
    expect(payload.next_action).toBe('continue working on the failing tests');
  });
});

describe('AC3 — Claude Code transcripts are not modified', () => {
  it('claude_code_transcripts_not_modified', async () => {
    const { startSession } = await import(PROD.lifecycle);

    const repoDir = makeTmpDir('af-no-snap');
    makeRepoSkeleton(repoDir, {
      pointer: { schema_version: 2, active_session_id: null, updated_at: '2026-05-24T12:00:00Z' },
    });
    // Synthetic Claude Code transcript dir, contents read by the production
    // code via env var CLAUDE_CODE_TRANSCRIPT_DIR (see proposal §8 Concerns).
    const transcriptDir = makeTmpDir('af-claudecode');
    const transcriptFile = join(transcriptDir, 'session-abc.jsonl');
    writeFileSync(transcriptFile, 'original-content\n', 'utf8');
    const before = readFileSync(transcriptFile, 'utf8');
    const beforeMtime = statSync(transcriptFile).mtimeMs;

    process.env.CLAUDE_CODE_TRANSCRIPT_DIR = transcriptDir;
    try {
      await startSession({ repoRoot: repoDir, snapshotTranscript: false });
    } finally {
      delete process.env.CLAUDE_CODE_TRANSCRIPT_DIR;
    }

    // Transcript file untouched.
    expect(readFileSync(transcriptFile, 'utf8')).toBe(before);
    expect(statSync(transcriptFile).mtimeMs).toBe(beforeMtime);

    // transcript.ref.json may or may not exist; if it does, it must not contain
    // the transcript content (refs + checksums only).
    // Find the newly-created bundle dir.
    const ptr = JSON.parse(readFileSync(pointerPath(repoDir), 'utf8'));
    const refPath = join(bundlePath(repoDir, ptr.active_session_id), 'transcript.ref.json');
    if (existsSync(refPath)) {
      const ref = JSON.parse(readFileSync(refPath, 'utf8'));
      const serialized = JSON.stringify(ref);
      expect(serialized.includes('original-content')).toBe(false);
    }
    // transcript.snapshot/ must NOT exist when snapshotTranscript=false.
    expect(existsSync(join(bundlePath(repoDir, ptr.active_session_id), 'transcript.snapshot')))
      .toBe(false);
  });
});

describe('AC3 — transcript snapshot copied when opted in', () => {
  it('transcript_snapshot_present_when_opted_in', async () => {
    const { startSession, pauseSession } = await import(PROD.lifecycle);

    const repoDir = makeTmpDir('af-snap');
    makeRepoSkeleton(repoDir, {
      pointer: { schema_version: 2, active_session_id: null, updated_at: '2026-05-24T12:00:00Z' },
    });
    const transcriptDir = makeTmpDir('af-claudecode2');
    const transcriptFile = join(transcriptDir, 'session-xyz.jsonl');
    const content = readFileSync(
      join(REPO_ROOT, 'tests', 'fixtures', 'transcript-sample.txt'),
      'utf8',
    );
    writeFileSync(transcriptFile, content, 'utf8');
    const srcSha = createHash('sha256').update(content).digest('hex');

    process.env.CLAUDE_CODE_TRANSCRIPT_DIR = transcriptDir;
    try {
      await startSession({ repoRoot: repoDir, snapshotTranscript: true });
      // Per ticket comment 2026-05-24 resolved Q #2, snapshot also runs on pause.
      await pauseSession({
        repoRoot: repoDir,
        handoffSummary: 'mid-task pause',
        nextAction: 'resume tomorrow',
      });
    } finally {
      delete process.env.CLAUDE_CODE_TRANSCRIPT_DIR;
    }

    const ptr = JSON.parse(readFileSync(pointerPath(repoDir), 'utf8'));
    const snapDir = join(bundlePath(repoDir, ptr.active_session_id), 'transcript.snapshot');
    expect(existsSync(snapDir), 'transcript.snapshot/ must exist').toBe(true);
    const snapped = readFileSync(join(snapDir, 'session-xyz.jsonl'), 'utf8');
    const dstSha = createHash('sha256').update(snapped).digest('hex');
    expect(dstSha).toBe(srcSha);
  });
});
