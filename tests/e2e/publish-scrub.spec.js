// tests/publish-scrub.spec.js
// TASK-027 — Plugin chain P7 (AC4): publish-prep scrub guarantee.
//
// AC4: "running `bin/make-template.js --yes` at publish time yields a shipped
// plugin carrying ZERO dev tickets/state (verified against the TASK-019
// pristine-template guarantees)."
//
// This is the PUBLISH-TIME use that justified keeping make-template in the repo
// but OUT of the shipped bin/ (TASK-020 §B.3, §I Q2). It reuses the TASK-019
// makeTemplate({repoRoot, now, apply}) core directly — no shelling out — against
// a temp dev-repo skeleton carrying realistic dev residue.
//
// RELATIONSHIP TO tests/make-template.spec.js (TASK-019): that suite owns the
// fine-grained AC-by-AC contract (exact tasks/ contents, byte-identical asset
// survival, dry-run identity, init clone-readiness). This suite does NOT
// duplicate or weaken those. It ADDS the single publish-time angle AC4 demands:
// a from-the-publisher's-seat assertion that after the scrub the would-be
// SHIPPED plugin carries ZERO dev TASK-*.json tickets, ZERO state/sessions
// residue, and an EMPTY tasks/index.json — i.e. the dev backlog never leaks into
// the distributed plugin.
//
// EXPECTED RESULT NOTE: make-template already implements these removals
// (TASK-019). So these specs are expected to PASS immediately — they are a
// REGRESSION LOCK pinning the publish-scrub guarantee at the P7 layer, not a
// red-then-green TDD pair. That is acceptable and expected for a capstone
// ticket whose AC4 is "confirm the guarantee holds." See the report.

import { describe, it, expect, afterAll } from 'vitest';
import {
  existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync,
} from 'node:fs';
import { join } from 'node:path';

import { PROD, makeRepoSkeleton, seedActiveBundle } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

const FIXED_NOW = '2026-05-29T00:00:00Z';

/** Minimal dev ticket payload — make-template removes bytes, not re-validates.
 *  Deliberately NO `seed` label: these are framework-HISTORY-style dev tickets
 *  (the kind that must never reach a published plugin). */
function devTicket(key) {
  return {
    key,
    title: `Dev ${key}`,
    description: 'framework-development residue — must not ship',
    acceptance_criteria: ['x'],
    status: 'done',
    priority: 'medium',
    labels: ['plugin-chain'],
    assignee: null,
    depends_on: [],
    linked_commits: [],
    linked_prs: [],
    comments: [],
    created_at: '2026-05-20T00:00:00Z',
    updated_at: '2026-05-21T00:00:00Z',
    jira_key: null,
  };
}

/**
 * Stand up a dev-repo skeleton ready for the publish-time scrub: dev tickets
 * (no seed label), a populated index.json, a state pointer, and a dev session
 * bundle under state/sessions/<id>/.
 */
function makeDevRepoForPublish(label) {
  const repoDir = makeTmpDir(label);
  makeRepoSkeleton(repoDir, {
    pointer: {
      schema_version: 2,
      active_session_id: '20260521T101010Z-abcd1234',
      updated_at: '2026-05-21T10:10:10Z',
    },
    tasks: {
      'TASK-019': devTicket('TASK-019'),
      'TASK-020': devTicket('TASK-020'),
      'TASK-027': devTicket('TASK-027'),
    },
  });

  // A populated index.json (the dev backlog index) that must be reset to empty.
  writeFileSync(
    join(repoDir, 'tasks', 'index.json'),
    JSON.stringify(
      {
        generated_at: '2026-05-21T10:10:10Z',
        tasks: [
          { key: 'TASK-019', status: 'done' },
          { key: 'TASK-020', status: 'done' },
          { key: 'TASK-027', status: 'in_progress' },
        ],
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  // tasks/ asset files that MUST survive the scrub.
  writeFileSync(
    join(repoDir, 'tasks', 'schema.json'),
    JSON.stringify({ $id: 'tasks/schema.json', type: 'object' }, null, 2) + '\n',
    'utf8',
  );
  writeFileSync(join(repoDir, 'tasks', 'README.md'), '# tasks\n', 'utf8');

  // A research sidecar — the kind the runtime archiver leaves behind but the
  // publish scrub must remove.
  writeFileSync(
    join(repoDir, 'tasks', 'TASK-020.research.md'),
    '# spike notes — dev residue\n',
    'utf8',
  );

  // A dev session bundle under state/sessions/.
  seedActiveBundle(join(repoDir, 'state', 'sessions', '20260521T101010Z-abcd1234'));

  // A base agent that MUST survive (asset, not residue).
  mkdirSync(join(repoDir, '.claude', 'agents'), { recursive: true });
  writeFileSync(
    join(repoDir, '.claude', 'agents', 'orchestrator.md'),
    '# orchestrator (base asset — must survive publish scrub)\n',
    'utf8',
  );

  return repoDir;
}

function devTicketFiles(repoDir) {
  return readdirSync(join(repoDir, 'tasks')).filter((n) => /^TASK-/.test(n));
}

function sessionsResidue(repoDir) {
  const dir = join(repoDir, 'state', 'sessions');
  return existsSync(dir) ? readdirSync(dir) : [];
}

// ===========================================================================
// AC4 — the shipped plugin carries ZERO dev tickets after the publish scrub.
// ===========================================================================
describe('AC4 — make-template --yes scrubs all dev tickets for publish', () => {
  it('zero_dev_TASK_files_remain_after_apply', async () => {
    const { makeTemplate } = await import(PROD.makeTemplate);
    const repoDir = makeDevRepoForPublish('af-pub-tickets');

    // Sanity: dev residue is present pre-scrub (json tickets + a sidecar).
    expect(devTicketFiles(repoDir).sort()).toEqual([
      'TASK-019.json',
      'TASK-020.json',
      'TASK-020.research.md',
      'TASK-027.json',
    ]);

    await makeTemplate({ repoRoot: repoDir, now: () => FIXED_NOW, apply: true });

    // The publish-time guarantee: no TASK-* file (json OR sidecar) survives into
    // the shipped plugin.
    expect(
      devTicketFiles(repoDir),
      'a published plugin must carry ZERO dev TASK-* tickets/sidecars',
    ).toEqual([]);
  });

  it('tasks_index_is_reset_to_an_empty_store', async () => {
    const { makeTemplate } = await import(PROD.makeTemplate);
    const repoDir = makeDevRepoForPublish('af-pub-index');

    await makeTemplate({ repoRoot: repoDir, now: () => FIXED_NOW, apply: true });

    const idx = JSON.parse(readFileSync(join(repoDir, 'tasks', 'index.json'), 'utf8'));
    expect(
      idx.tasks,
      'the shipped tasks/index.json must list zero tickets',
    ).toEqual([]);
  });

  it('tasks_schema_and_readme_assets_survive_the_scrub', async () => {
    // Negative guard: scrubbing tickets must NOT remove the framework assets the
    // plugin still needs to ship.
    const { makeTemplate } = await import(PROD.makeTemplate);
    const repoDir = makeDevRepoForPublish('af-pub-assets');

    await makeTemplate({ repoRoot: repoDir, now: () => FIXED_NOW, apply: true });

    expect(existsSync(join(repoDir, 'tasks', 'schema.json'))).toBe(true);
    expect(existsSync(join(repoDir, 'tasks', 'README.md'))).toBe(true);
    expect(
      existsSync(join(repoDir, '.claude', 'agents', 'orchestrator.md')),
      'base agents must survive into the shipped plugin',
    ).toBe(true);
  });
});

// ===========================================================================
// AC4 — the shipped plugin carries ZERO session-state residue after the scrub.
// ===========================================================================
describe('AC4 — make-template --yes scrubs all session state for publish', () => {
  it('no_session_bundle_residue_remains_after_apply', async () => {
    const { makeTemplate } = await import(PROD.makeTemplate);
    const repoDir = makeDevRepoForPublish('af-pub-sessions');

    // Sanity: a dev bundle exists pre-scrub.
    expect(sessionsResidue(repoDir)).toContain('20260521T101010Z-abcd1234');

    await makeTemplate({ repoRoot: repoDir, now: () => FIXED_NOW, apply: true });

    // The publish-time guarantee: no session bundle ships in the plugin.
    expect(
      sessionsResidue(repoDir),
      'a published plugin must carry ZERO state/sessions residue',
    ).toEqual([]);
  });

  it('state_pointer_is_reset_to_idle_for_the_shipped_plugin', async () => {
    const { makeTemplate } = await import(PROD.makeTemplate);
    const repoDir = makeDevRepoForPublish('af-pub-pointer');

    await makeTemplate({ repoRoot: repoDir, now: () => FIXED_NOW, apply: true });

    const pointer = JSON.parse(
      readFileSync(join(repoDir, 'state', 'session.json'), 'utf8'),
    );
    expect(
      pointer.active_session_id,
      'the shipped pointer must be idle (no active dev session leaks)',
    ).toBeNull();
  });
});
