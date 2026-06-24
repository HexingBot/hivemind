// src/transcript.js
// Claude Code transcript snapshot logic.
//
// Per resolved Q #2: when a session was started with snapshotTranscript=true,
// we capture the transcript on EVERY pause and on end. Not opt-in per-call.
//
// Per resolved Q #3: the Claude Code transcript directory on Windows was
// discovered empirically in phase 3b. Layout under the user's home dir:
//
//   ~/.claude/projects/<encoded-project-path>/
//     <session-uuid>.jsonl                       # main chat transcript(s)
//     <session-uuid>/subagents/agent-<id>.jsonl  # subagent transcripts
//
// Where <encoded-project-path> is the absolute path to the project root with
// path separators (`\` and `:`) replaced by `-`. Example for the framework:
//   C:\Users\srpar\OneDrive\Documents\hivemind
//   → C--Users-srpar-OneDrive-Documents-hivemind
//
// resolveTranscriptDir prefers (1) the CLAUDE_CODE_TRANSCRIPT_DIR env var when
// set, (2) the discovered ~/.claude/projects/<encoded(repoRoot)>/ path when it
// exists, (3) null when neither is available. Snapshot is then a no-op when
// null — the bundle still works, it just doesn't carry verbatim history.

import {
  existsSync, mkdirSync, readdirSync, readFileSync, copyFileSync, statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

import { atomicWriteFile } from './atomic-write.js';
import {
  bundleTranscriptRefPath, bundleTranscriptSnapshotDir,
} from './bundle.js';

/**
 * Compute the encoded project-path component used under ~/.claude/projects/.
 * Replaces backslashes, forward slashes, and colons with dashes.
 *
 * @param {string} repoRoot - absolute path to the project root
 * @returns {string} encoded directory name
 */
export function encodeProjectPath(repoRoot) {
  const abs = resolve(repoRoot);
  return abs.replace(/[\\/:]+/g, '-');
}

/**
 * Resolve the Claude Code transcript directory.
 * Precedence:
 *   1. CLAUDE_CODE_TRANSCRIPT_DIR env var (override; useful in tests).
 *   2. ~/.claude/projects/<encoded(repoRoot)>/  when it exists.
 *   3. null.
 *
 * @param {{ repoRoot?: string }} [opts]
 * @returns {string|null}
 */
export function resolveTranscriptDir(opts = {}) {
  const env = process.env.CLAUDE_CODE_TRANSCRIPT_DIR;
  if (env && env.length > 0) return env;
  if (opts.repoRoot) {
    const candidate = join(homedir(), '.claude', 'projects', encodeProjectPath(opts.repoRoot));
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Compute checksums for transcript files in the source dir and write them
 * to transcript.ref.json inside the bundle. Does NOT modify the source files.
 *
 * @returns {Promise<Array<{path: string, sha256: string, exists_at_capture: boolean}>>}
 */
export async function captureTranscriptRefs({ repoRoot, sessionId }) {
  const src = resolveTranscriptDir({ repoRoot });
  if (!src || !existsSync(src)) {
    return [];
  }
  const refs = [];
  for (const name of readdirSync(src)) {
    const full = join(src, name);
    let exists = false;
    let sha = null;
    try {
      const stat = statSync(full);
      if (stat.isFile()) {
        exists = true;
        const content = readFileSync(full);
        sha = createHash('sha256').update(content).digest('hex');
      }
    } catch {
      exists = false;
    }
    refs.push({ path: full, exists_at_capture: exists, sha256: sha });
  }
  const refDoc = { claude_code_transcripts: refs };
  await atomicWriteFile(
    bundleTranscriptRefPath(repoRoot, sessionId),
    JSON.stringify(refDoc, null, 2) + '\n',
  );
  return refs;
}

/**
 * Copy every file from the configured transcript dir into the bundle's
 * transcript.snapshot/ directory. Overwrites any previous snapshot copy
 * (snapshot is taken on every pause+end per resolved Q #2).
 *
 * Does NOT touch the source files.
 */
export async function snapshotTranscripts({ repoRoot, sessionId }) {
  const src = resolveTranscriptDir({ repoRoot });
  if (!src || !existsSync(src)) {
    return { copied: 0, skipped: 'no_transcript_dir' };
  }
  const dstDir = bundleTranscriptSnapshotDir(repoRoot, sessionId);
  if (!existsSync(dstDir)) mkdirSync(dstDir, { recursive: true });

  let copied = 0;
  for (const name of readdirSync(src)) {
    const full = join(src, name);
    let isFile = false;
    try {
      isFile = statSync(full).isFile();
    } catch {
      isFile = false;
    }
    if (!isFile) continue;
    const dst = join(dstDir, name);
    copyFileSync(full, dst);
    copied++;
  }
  return { copied };
}
