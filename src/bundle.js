// src/bundle.js
// Bundle directory operations: path helpers, id generation, manifest/lifecycle.log IO.

import {
  mkdirSync, existsSync, readFileSync, appendFileSync, readdirSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

import { atomicWriteFile } from './atomic-write.js';
import { hostFingerprint } from './host.js';

/**
 * YYYYMMDDTHHMMSSZ-<8-hex>. Sortable by creation time, collision-resistant.
 */
export function newSessionId(now = new Date()) {
  const y = now.getUTCFullYear().toString().padStart(4, '0');
  const mo = (now.getUTCMonth() + 1).toString().padStart(2, '0');
  const d = now.getUTCDate().toString().padStart(2, '0');
  const h = now.getUTCHours().toString().padStart(2, '0');
  const mi = now.getUTCMinutes().toString().padStart(2, '0');
  const s = now.getUTCSeconds().toString().padStart(2, '0');
  const ts = `${y}${mo}${d}T${h}${mi}${s}Z`;
  const hex = randomBytes(4).toString('hex');
  return `${ts}-${hex}`;
}

export function bundleDirFor(repoRoot, sessionId) {
  return join(repoRoot, 'state', 'sessions', sessionId);
}

export function sessionsDir(repoRoot) {
  return join(repoRoot, 'state', 'sessions');
}

export function bundleSessionPath(repoRoot, sessionId) {
  return join(bundleDirFor(repoRoot, sessionId), 'session.json');
}

export function bundleManifestPath(repoRoot, sessionId) {
  return join(bundleDirFor(repoRoot, sessionId), 'manifest.json');
}

export function bundleLifecycleLogPath(repoRoot, sessionId) {
  return join(bundleDirFor(repoRoot, sessionId), 'lifecycle.log');
}

export function bundleTranscriptRefPath(repoRoot, sessionId) {
  return join(bundleDirFor(repoRoot, sessionId), 'transcript.ref.json');
}

export function bundleTranscriptSnapshotDir(repoRoot, sessionId) {
  return join(bundleDirFor(repoRoot, sessionId), 'transcript.snapshot');
}

/**
 * Read the bundle's session.json. Returns the parsed object.
 */
export function readBundleSession(repoRoot, sessionId) {
  const p = bundleSessionPath(repoRoot, sessionId);
  return JSON.parse(readFileSync(p, 'utf8'));
}

function makeErr(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

/**
 * readBundleSessionOrThrow(repoRoot, sessionId, callerLabel) — TASK-092.
 *
 * Same read as readBundleSession, but tailors the missing-bundle-dir case
 * (the pointer names a session whose bundle directory was deleted or moved
 * out from under it) into a typed E_BUNDLE_MISSING error naming the session
 * id, the expected session.json path, and callerLabel (the calling
 * function's name, for symptom attribution across call sites). Any other
 * error (e.g. corrupt JSON / SyntaxError) is rethrown raw, unchanged.
 *
 * readBundleSession itself is deliberately left unchanged — this is an
 * ADDITIVE export so callers that already handle the raw ENOENT themselves
 * (src/close-guard.js, src/lifecycle.js) are unaffected.
 */
export function readBundleSessionOrThrow(repoRoot, sessionId, callerLabel) {
  try {
    return readBundleSession(repoRoot, sessionId);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      throw makeErr(
        'E_BUNDLE_MISSING',
        `${callerLabel}: bundle for session ${sessionId} is missing — the pointer names it but no session.json was found at ${bundleSessionPath(repoRoot, sessionId)}.`,
      );
    }
    throw err;
  }
}

/**
 * Atomically write the bundle's session.json (the per-bundle state file).
 */
export async function writeBundleSession(repoRoot, sessionId, payload) {
  const dir = bundleDirFor(repoRoot, sessionId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const target = bundleSessionPath(repoRoot, sessionId);
  await atomicWriteFile(target, JSON.stringify(payload, null, 2) + '\n');
}

/**
 * Append a single JSONL entry to lifecycle.log. Not atomic across crashes,
 * but appendFile is single-syscall on POSIX and Windows for small writes;
 * we tolerate the rare last-record-truncation case because lifecycle.log is
 * an audit trail, not authoritative state.
 */
export function appendLifecycleLog(repoRoot, sessionId, entry) {
  const p = bundleLifecycleLogPath(repoRoot, sessionId);
  if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, JSON.stringify(entry) + '\n', 'utf8');
}

/**
 * Build the initial manifest for a freshly-started bundle.
 */
export function makeManifest({ sessionId, createdAt, snapshotTranscript, transcriptRefs = [] }) {
  return {
    session_id: sessionId,
    schema_version: 1,
    created_at: createdAt,
    host: hostFingerprint(),
    snapshot_transcript: !!snapshotTranscript,
    transcript_refs: transcriptRefs,
  };
}

/**
 * Write manifest.json atomically.
 */
export async function writeManifest(repoRoot, sessionId, manifest) {
  const dir = bundleDirFor(repoRoot, sessionId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const target = bundleManifestPath(repoRoot, sessionId);
  await atomicWriteFile(target, JSON.stringify(manifest, null, 2) + '\n');
}

/**
 * Read manifest.json. Returns the parsed object.
 */
export function readManifest(repoRoot, sessionId) {
  return JSON.parse(readFileSync(bundleManifestPath(repoRoot, sessionId), 'utf8'));
}

/**
 * List bundle directories (top-level only) under state/sessions/.
 */
export function listBundles(repoRoot) {
  const dir = sessionsDir(repoRoot);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}
