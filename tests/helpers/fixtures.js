// tests/helpers/fixtures.js
// Shared fixture builders. These create on-disk skeletons under a caller-provided
// temp directory; they do NOT touch the real repo's state/ or knowledge/ directories.

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Build a fresh "framework repo" skeleton at `repoDir`.
 * Creates state/ with a v2 pointer file, tasks/, and any provided fixture files.
 * Does NOT create knowledge/ or state/sessions/ — those are the production
 * artifacts under test and must be created by implementation code, not fixtures.
 */
export function makeRepoSkeleton(repoDir, opts = {}) {
  mkdirSync(repoDir, { recursive: true });
  mkdirSync(join(repoDir, 'state'), { recursive: true });
  mkdirSync(join(repoDir, 'tasks'), { recursive: true });

  if (opts.pointer) {
    writeFileSync(
      join(repoDir, 'state', 'session.json'),
      JSON.stringify(opts.pointer, null, 2),
      'utf8',
    );
  }
  if (opts.tasks) {
    for (const [key, payload] of Object.entries(opts.tasks)) {
      writeFileSync(
        join(repoDir, 'tasks', `${key}.json`),
        JSON.stringify(payload, null, 2),
        'utf8',
      );
    }
  }
  return repoDir;
}

/**
 * Seed an "active" session bundle at the given path.
 * Writes session.json (bundle-state shape), manifest.json, and lifecycle.log
 * with one start entry. Returns the bundle metadata.
 */
export function seedActiveBundle(bundleDir, overrides = {}) {
  mkdirSync(bundleDir, { recursive: true });

  const sessionId =
    overrides.session_id || bundleDir.split(/[\\/]/).pop();
  const now = overrides.created_at || '2026-05-24T12:00:00Z';

  const sessionJson = {
    schema_version: 2,
    session_id: sessionId,
    lifecycle_state: 'active',
    updated_at: now,
    active_task: 'TASK-004',
    workflow_step: 'test',
    next_action: 'continue working on the failing tests',
    handoff_summary: 'session was just started',
    open_questions: [],
    blockers: [],
    decisions: [],
    subagent_results: [],
    pending_human_confirmation: null,
    ...overrides.session_json_extra,
  };

  const manifestJson = {
    session_id: sessionId,
    schema_version: 1,
    created_at: now,
    host: 'a'.repeat(64), // sha256 hex placeholder
    snapshot_transcript: false,
    transcript_refs: [],
    ...overrides.manifest_extra,
  };

  writeFileSync(
    join(bundleDir, 'session.json'),
    JSON.stringify(sessionJson, null, 2),
    'utf8',
  );
  writeFileSync(
    join(bundleDir, 'manifest.json'),
    JSON.stringify(manifestJson, null, 2),
    'utf8',
  );
  writeFileSync(
    join(bundleDir, 'lifecycle.log'),
    JSON.stringify({
      at: now,
      op: 'start',
      from_step: null,
      to_step: 'test',
      idempotent_noop: false,
    }) + '\n',
    'utf8',
  );

  return { sessionId, bundleDir, sessionJson, manifestJson };
}

/**
 * Seed a paused or ended bundle by mutating an already-active one.
 */
export function seedBundleInState(bundleDir, lifecycleState, overrides = {}) {
  const meta = seedActiveBundle(bundleDir, overrides);
  // Rewrite session.json with the given lifecycle_state.
  const path = join(bundleDir, 'session.json');
  const current = JSON.parse(readFileSync(path, 'utf8'));
  current.lifecycle_state = lifecycleState;
  writeFileSync(path, JSON.stringify(current, null, 2), 'utf8');
  if (lifecycleState === 'ended') {
    writeFileSync(
      join(bundleDir, 'summary.md'),
      '# Session ' + meta.sessionId + '\n\n(seeded for tests)\n',
      'utf8',
    );
  }
  return meta;
}

/**
 * Standard ID generator for tests. Deterministic given a counter.
 */
export function makeSessionId(seed = 0) {
  const ts = '20260524T120000Z';
  const hex = (0xdeadbeef + seed).toString(16).padStart(8, '0').slice(-8);
  return `${ts}-${hex}`;
}

/**
 * Path helpers — keep tests insulated from path layout.
 */
export function bundlePath(repoDir, sessionId) {
  return join(repoDir, 'state', 'sessions', sessionId);
}

export function pointerPath(repoDir) {
  return join(repoDir, 'state', 'session.json');
}

/**
 * Assert that a directory tree contains *only* the listed entries (top-level).
 */
export function hasExactly(actualEntries, expected) {
  const a = [...actualEntries].sort();
  const e = [...expected].sort();
  return JSON.stringify(a) === JSON.stringify(e);
}

/**
 * Sentinel file path the production code is supposed to expose. Tests import
 * via dynamic import(); we resolve each module to an absolute file:// URL so
 * Vite's dynamic-import resolver doesn't try to interpret variable specifiers
 * as bare module ids. Each entry stays a fully-qualified URL string.
 *
 * When a module does not yet exist on disk, dynamic import still fails with
 * the right "module not found" surface — Vite reports the missing file by
 * its resolved file URL — which is still a "right" failure for tests-first.
 */
const __thisDir = dirname(fileURLToPath(import.meta.url));
const __srcDir = join(__thisDir, '..', '..', 'src');
const __binDir = join(__thisDir, '..', '..', 'bin');
function prodUrl(name) {
  return pathToFileURL(join(__srcDir, name)).href;
}
function binUrl(name) {
  return pathToFileURL(join(__binDir, name)).href;
}
export const PROD = Object.freeze({
  lifecycle: prodUrl('lifecycle.js'),
  pointer: prodUrl('pointer.js'),
  bundle: prodUrl('bundle.js'),
  summary: prodUrl('summary.js'),
  inspection: prodUrl('inspection.js'),
  knowledge: prodUrl('knowledge.js'),
  schemas: prodUrl('schemas.js'),
  recovery: prodUrl('recovery.js'),
  migrate: prodUrl('migrate.js'),
  transcript: prodUrl('transcript.js'),
  taskStore: prodUrl('task-store.js'),
  questionEngine: prodUrl('question-engine.js'),
  questionLibrary: prodUrl('question-library.js'),
  projectMd: prodUrl('project-md.js'),
  designProfile: prodUrl('design-profile.js'),
  integrationsLock: prodUrl('integrations-lock.js'),
  packReconcile: prodUrl('pack-reconcile.js'),
  packApply: prodUrl('pack-apply.js'),
  assimilate: prodUrl('assimilate.js'),
  claudeMd: prodUrl('claude-md.js'),
  agentGenerator: prodUrl('agent-generator.js'),
  backlogSeeder: prodUrl('backlog-seeder.js'),
  frameworkHistory: prodUrl('framework-history.js'),
  repoRoot: prodUrl('repo-root.js'),
  newTaskCli: binUrl('new-task.js'),
  init: binUrl('init.js'),
  makeTemplate: binUrl('make-template.js'),
});
