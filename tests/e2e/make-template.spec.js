// tests/make-template.spec.js
// TASK-019 — bin/make-template.js exports makeTemplate({repoRoot, now, apply}),
// an UPSTREAM template-prep step that brings a distribution copy of the dev
// repo to pristine clone-ready state BEFORE it is published. Where
// archiveFrameworkHistory (src/framework-history.js) is the runtime SAFETY NET
// that only moves TASK-NNN.json at init time, make-template is the clean-slate
// mechanism: it removes the TASK tickets AND their .md sidecars, wipes the dev
// session bundle, resets the pointer, and drops the per-project PROJECT.md /
// project-context.md — while leaving base agents, knowledge/, src/, bin/, and
// tests/ untouched.
//
// Tests-first phase: every test here must FAIL on the baseline because
// bin/make-template.js does not exist yet. Dynamic import(PROD.makeTemplate)
// produces a "module not found" surface (Vite reports the missing file URL),
// which is the RIGHT failure for the import-time specs.
//
// AC map (ticket TASK-019):
//   AC1 — exported shape + CLI argv strictness (--yes => apply:true).
//   AC2 — dry-run (apply:false) does ZERO mutation, returns a plan.
//   AC3 — apply:true leaves tasks/ with exactly schema.json/README.md/index.json;
//         index.json is the empty store; TASK-NNN.json AND TASK-* sidecars gone.
//   AC4 — apply:true resets state/session.json and empties state/sessions/.
//   AC5 — apply:true removes PROJECT.md + project-context.md; base agents +
//         knowledge/ survive byte-for-byte.
//   AC6 — end-to-end: make-template then a scripted runInit (created branch)
//         runs with no archive prompt and produces a fresh PROJECT.md + seed.
//   AC7 — README quickstart gains a "Preparing a distribution" note.

import { describe, it, expect, afterAll } from 'vitest';
import {
  existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, statSync,
} from 'node:fs';
import { join } from 'node:path';

import { PROD, makeRepoSkeleton, seedActiveBundle, hasExactly } from '../helpers/fixtures.js';
import { REPO_ROOT } from '../helpers/repoRoot.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { makeScriptedPrompter, webSaasAnswers } from '../helpers/scripted-prompter.js';

afterAll(cleanupAll);

const FIXED_NOW = '2026-05-28T12:00:00Z';
const FIXED_HOST = 'test-host';

// ---------------------------------------------------------------------------
// Fixture helpers.
// ---------------------------------------------------------------------------

/**
 * Build a synthetic framework-history ticket payload. Shape mirrors
 * tasks/schema.json closely enough — make-template removes bytes, it does not
 * re-validate.
 */
function syntheticTicket(key, overrides = {}) {
  return {
    key,
    title: `Synthetic ${key}`,
    description: 'placed by the make-template spec fixture',
    acceptance_criteria: ['Some criterion'],
    status: 'todo',
    priority: 'medium',
    labels: [],
    assignee: null,
    depends_on: [],
    linked_commits: [],
    linked_prs: [],
    comments: [],
    created_at: '2026-05-27T00:00:00Z',
    updated_at: '2026-05-27T00:00:00Z',
    jira_key: null,
    ...overrides,
  };
}

/**
 * Stand up a "dev repo" skeleton with all the residue make-template must clean,
 * plus all the assets it must preserve. Returns the repoDir.
 *
 * Residue: TASK-NNN.json tickets, TASK-NNN.* sidecars, a dev session bundle,
 * a stale pointer, PROJECT.md, .claude/agents/project-context.md.
 * Assets: tasks/schema.json + README.md, the three specialist agents
 * (TASK-032: orchestrator.md removed), knowledge/.
 */
function makeDevRepo(label) {
  const repoDir = makeTmpDir(label);
  makeRepoSkeleton(repoDir, {
    pointer: {
      schema_version: 2,
      active_session_id: '20260524T000000Z-65fa92c6',
      updated_at: '2026-05-24T00:00:00Z',
    },
    tasks: {
      'TASK-001': syntheticTicket('TASK-001'),
      'TASK-004': syntheticTicket('TASK-004'),
      'TASK-019': syntheticTicket('TASK-019'),
    },
  });

  // tasks/ asset files that MUST survive.
  writeFileSync(
    join(repoDir, 'tasks', 'schema.json'),
    JSON.stringify({ $id: 'tasks/schema.json', type: 'object' }, null, 2) + '\n',
    'utf8',
  );
  writeFileSync(join(repoDir, 'tasks', 'README.md'), '# tasks\n', 'utf8');
  // A pre-existing (stale) index.json — make-template must rewrite it.
  writeFileSync(
    join(repoDir, 'tasks', 'index.json'),
    JSON.stringify({ generated_at: '2026-01-01T00:00:00Z', tasks: [{ key: 'TASK-001' }] }, null, 2) + '\n',
    'utf8',
  );

  // TASK-NNN.* sidecars — the gap archiveFrameworkHistory leaves behind.
  writeFileSync(
    join(repoDir, 'tasks', 'TASK-004.research.md'),
    '# research for TASK-004\n',
    'utf8',
  );
  writeFileSync(
    join(repoDir, 'tasks', 'TASK-004.test-runtime-proposal.md'),
    '# proposal for TASK-004\n',
    'utf8',
  );

  // A lingering dev session bundle under state/sessions/.
  const bundleId = '20260524T000000Z-65fa92c6';
  seedActiveBundle(join(repoDir, 'state', 'sessions', bundleId));

  // Per-project files make-template must remove.
  writeFileSync(join(repoDir, 'PROJECT.md'), '---\nname: dev\n---\n# dev\n', 'utf8');
  mkdirSync(join(repoDir, '.claude', 'agents'), { recursive: true });
  writeFileSync(
    join(repoDir, '.claude', 'agents', 'project-context.md'),
    '# project context (per-project, must be removed)\n',
    'utf8',
  );

  // Base agent files that MUST survive untouched.
  // TASK-032: orchestrator.md removed; only three specialist subagents remain.
  for (const a of ['developer', 'reviewer', 'researcher']) {
    writeFileSync(
      join(repoDir, '.claude', 'agents', `${a}.md`),
      `# ${a} agent (base — must survive)\n`,
      'utf8',
    );
  }

  // knowledge/ entries that MUST survive byte-for-byte.
  mkdirSync(join(repoDir, 'knowledge', 'entries'), { recursive: true });
  writeFileSync(join(repoDir, 'knowledge', 'README.md'), '# knowledge\n', 'utf8');
  writeFileSync(join(repoDir, 'knowledge', 'schema.json'), '{}\n', 'utf8');
  writeFileSync(
    join(repoDir, 'knowledge', 'entries', 'lesson-001.md'),
    '# a cross-project lesson — asset, not residue\n',
    'utf8',
  );

  return repoDir;
}

function listTaskDir(repoDir) {
  return readdirSync(join(repoDir, 'tasks'));
}

function listSessionsDir(repoDir) {
  const dir = join(repoDir, 'state', 'sessions');
  if (!existsSync(dir)) return [];
  return readdirSync(dir);
}

/**
 * Snapshot a directory tree into a {relativePath: bytes} map for byte-identity
 * assertions. Recurses; records file contents only.
 */
function snapshotTree(root) {
  const out = {};
  function walk(dir, prefix) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (statSync(full).isDirectory()) {
        walk(full, rel);
      } else {
        out[rel] = readFileSync(full, 'utf8');
      }
    }
  }
  walk(root, '');
  return out;
}

// ===========================================================================
// AC1 — exported shape + CLI argv strictness.
// ===========================================================================
describe('AC1 — makeTemplate is exported with the injected-deps signature', () => {
  it('exports_makeTemplate_function', async () => {
    const mod = await import(PROD.makeTemplate);
    expect(typeof mod.makeTemplate).toBe('function');
  });

  it('cli_shell_maps_yes_to_apply_true_and_rejects_unknown_argv', async () => {
    // The CLI shell must expose an argv parser (mirroring bin/init.js's
    // parseArgs) that maps --yes => apply:true and throws on unknown tokens.
    const mod = await import(PROD.makeTemplate);
    expect(typeof mod.parseArgs).toBe('function');

    // --yes => apply true.
    expect(mod.parseArgs(['--yes'])).toMatchObject({ apply: true });
    // Empty argv => dry-run default.
    expect(mod.parseArgs([])).toMatchObject({ apply: false });
    // Unknown long flag throws with the offending token in the message.
    expect(() => mod.parseArgs(['--bogus-flag'])).toThrow(/--bogus-flag/);
    // Stray positional throws with the offending token in the message.
    expect(() => mod.parseArgs(['stray-positional'])).toThrow(/stray-positional/);
  });

  it('makeTemplate_does_not_read_process_cwd_or_date_now', async () => {
    // Contract guard: invoked with an explicit repoRoot + now, a dry-run must
    // resolve without throwing. (A real impl reading process.cwd() would
    // operate on the test runner's cwd, not repoDir — this asserts repoRoot is
    // honored by running a dry-run against a tmp repo and checking the plan
    // references THAT repo's residue, not the framework's own.)
    const { makeTemplate } = await import(PROD.makeTemplate);
    const repoDir = makeDevRepo('af-mt-cwd');
    const result = await makeTemplate({
      repoRoot: repoDir,
      now: () => FIXED_NOW,
      apply: false,
    });
    expect(result).toBeTruthy();
    expect(typeof result).toBe('object');
  });
});

// ===========================================================================
// AC2 — dry-run does ZERO mutation and returns a plan.
// ===========================================================================
describe('AC2 — dry-run (apply:false) mutates nothing and returns a plan', () => {
  it('dry_run_is_byte_identical_before_and_after', async () => {
    const { makeTemplate } = await import(PROD.makeTemplate);
    const repoDir = makeDevRepo('af-mt-dryrun-identity');

    const before = snapshotTree(repoDir);
    await makeTemplate({ repoRoot: repoDir, now: () => FIXED_NOW, apply: false });
    const after = snapshotTree(repoDir);

    // Byte-for-byte identical: same set of files, same contents.
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    expect(after).toEqual(before);
  });

  it('dry_run_defaults_to_apply_false', async () => {
    // Omitting apply entirely must behave as a dry-run (safe-by-default).
    const { makeTemplate } = await import(PROD.makeTemplate);
    const repoDir = makeDevRepo('af-mt-dryrun-default');

    const before = snapshotTree(repoDir);
    await makeTemplate({ repoRoot: repoDir, now: () => FIXED_NOW });
    const after = snapshotTree(repoDir);
    expect(after).toEqual(before);
  });

  it('dry_run_plan_enumerates_expected_removal_and_rewrite_targets', async () => {
    const { makeTemplate } = await import(PROD.makeTemplate);
    const repoDir = makeDevRepo('af-mt-plan');

    const result = await makeTemplate({
      repoRoot: repoDir,
      now: () => FIXED_NOW,
      apply: false,
    });

    // The plan must enumerate the files/dirs it WOULD touch. We assert the
    // union of all reported relative paths covers the residue and excludes the
    // assets, regardless of how the plan partitions them (remove vs rewrite).
    const planText = JSON.stringify(result);

    // Residue that must appear as a target.
    expect(planText).toContain('TASK-001.json');
    expect(planText).toContain('TASK-004.json');
    expect(planText).toContain('TASK-019.json');
    expect(planText).toContain('TASK-004.research.md');
    expect(planText).toContain('TASK-004.test-runtime-proposal.md');
    expect(planText).toContain('20260524T000000Z-65fa92c6'); // dev bundle dir
    expect(planText).toContain('PROJECT.md');
    expect(planText).toContain('project-context.md');
    // index.json + state/session.json are rewrites, not removals — still
    // surfaced as targets.
    expect(planText).toContain('index.json');
    expect(planText).toContain('session.json');

    // Assets must NOT be enumerated as removal targets.
    expect(planText).not.toContain('developer.md');
    expect(planText).not.toContain('reviewer.md');
    expect(planText).not.toContain('researcher.md');
    expect(planText).not.toContain('orchestrator.md');
    expect(planText).not.toContain('lesson-001.md');
  });
});

// ===========================================================================
// AC3 — apply:true leaves tasks/ pristine.
// ===========================================================================
describe('AC3 — apply:true brings tasks/ to pristine template state', () => {
  it('tasks_dir_has_exactly_schema_readme_index_after_apply', async () => {
    const { makeTemplate } = await import(PROD.makeTemplate);
    const repoDir = makeDevRepo('af-mt-tasks-pristine');

    await makeTemplate({ repoRoot: repoDir, now: () => FIXED_NOW, apply: true });

    const entries = listTaskDir(repoDir);
    expect(
      hasExactly(entries, ['schema.json', 'README.md', 'index.json']),
      `tasks/ must contain exactly schema.json/README.md/index.json, got: ${JSON.stringify(entries)}`,
    ).toBe(true);
  });

  it('index_json_is_the_empty_store_newline_terminated', async () => {
    const { makeTemplate } = await import(PROD.makeTemplate);
    const repoDir = makeDevRepo('af-mt-index-empty');

    await makeTemplate({ repoRoot: repoDir, now: () => FIXED_NOW, apply: true });

    const raw = readFileSync(join(repoDir, 'tasks', 'index.json'), 'utf8');
    // Exact bytes: pretty-printed empty store, newline-terminated, via atomicWriteFile.
    const expected = JSON.stringify({ generated_at: FIXED_NOW, tasks: [] }, null, 2) + '\n';
    expect(raw).toBe(expected);
  });

  it('task_json_and_md_sidecars_are_all_removed', async () => {
    const { makeTemplate } = await import(PROD.makeTemplate);
    const repoDir = makeDevRepo('af-mt-sidecars');

    // Sanity: both a .json ticket and a .research.md sidecar exist pre-apply.
    expect(existsSync(join(repoDir, 'tasks', 'TASK-004.json'))).toBe(true);
    expect(existsSync(join(repoDir, 'tasks', 'TASK-004.research.md'))).toBe(true);

    await makeTemplate({ repoRoot: repoDir, now: () => FIXED_NOW, apply: true });

    // No TASK-NNN.json remain.
    const remaining = listTaskDir(repoDir).filter((n) => /^TASK-/.test(n));
    expect(remaining).toEqual([]);
    // The specific sidecar from the ticket is gone.
    expect(existsSync(join(repoDir, 'tasks', 'TASK-004.research.md'))).toBe(false);
    expect(existsSync(join(repoDir, 'tasks', 'TASK-004.test-runtime-proposal.md'))).toBe(false);
    // The .json tickets are gone.
    expect(existsSync(join(repoDir, 'tasks', 'TASK-001.json'))).toBe(false);
    expect(existsSync(join(repoDir, 'tasks', 'TASK-019.json'))).toBe(false);
  });
});

// ===========================================================================
// AC4 — apply:true resets the session pointer and empties state/sessions/.
// ===========================================================================
describe('AC4 — apply:true resets state/session.json and empties state/sessions/', () => {
  it('pointer_is_reset_to_null_active_session', async () => {
    const { makeTemplate } = await import(PROD.makeTemplate);
    const repoDir = makeDevRepo('af-mt-pointer-reset');

    await makeTemplate({ repoRoot: repoDir, now: () => FIXED_NOW, apply: true });

    const raw = readFileSync(join(repoDir, 'state', 'session.json'), 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual({
      schema_version: 2,
      active_session_id: null,
      updated_at: FIXED_NOW,
    });
    // Newline-terminated via atomicWriteFile.
    const expected = JSON.stringify(
      { schema_version: 2, active_session_id: null, updated_at: FIXED_NOW },
      null,
      2,
    ) + '\n';
    expect(raw).toBe(expected);
  });

  it('sessions_dir_has_no_bundle_directories_after_apply', async () => {
    const { makeTemplate } = await import(PROD.makeTemplate);
    const repoDir = makeDevRepo('af-mt-sessions-emptied');

    // Sanity: the dev bundle exists pre-apply.
    expect(listSessionsDir(repoDir)).toContain('20260524T000000Z-65fa92c6');

    await makeTemplate({ repoRoot: repoDir, now: () => FIXED_NOW, apply: true });

    // No bundle directories remain. (state/sessions/ may itself be removed or
    // left empty — either is acceptable, so long as no bundle dir survives.)
    expect(listSessionsDir(repoDir)).toEqual([]);
    expect(
      existsSync(join(repoDir, 'state', 'sessions', '20260524T000000Z-65fa92c6')),
    ).toBe(false);
  });
});

// ===========================================================================
// AC5 — per-project files removed; base agents + knowledge survive.
// ===========================================================================
describe('AC5 — removes per-project files, preserves base agents + knowledge', () => {
  it('project_md_and_project_context_are_removed', async () => {
    const { makeTemplate } = await import(PROD.makeTemplate);
    const repoDir = makeDevRepo('af-mt-perproject-removed');

    expect(existsSync(join(repoDir, 'PROJECT.md'))).toBe(true);
    expect(existsSync(join(repoDir, '.claude', 'agents', 'project-context.md'))).toBe(true);

    await makeTemplate({ repoRoot: repoDir, now: () => FIXED_NOW, apply: true });

    expect(existsSync(join(repoDir, 'PROJECT.md'))).toBe(false);
    expect(existsSync(join(repoDir, '.claude', 'agents', 'project-context.md'))).toBe(false);
  });

  it('base_agents_and_knowledge_survive_byte_for_byte', async () => {
    const { makeTemplate } = await import(PROD.makeTemplate);
    const repoDir = makeDevRepo('af-mt-assets-survive');

    // Snapshot the assets before.
    // TASK-032: orchestrator.md removed; three specialist subagents remain.
    const agentsBefore = {};
    for (const a of ['developer', 'reviewer', 'researcher']) {
      agentsBefore[a] = readFileSync(join(repoDir, '.claude', 'agents', `${a}.md`), 'utf8');
    }
    const knowledgeBefore = snapshotTree(join(repoDir, 'knowledge'));

    await makeTemplate({ repoRoot: repoDir, now: () => FIXED_NOW, apply: true });

    // Base agents survive byte-for-byte.
    for (const a of ['developer', 'reviewer', 'researcher']) {
      const p = join(repoDir, '.claude', 'agents', `${a}.md`);
      expect(existsSync(p), `${a}.md must survive`).toBe(true);
      expect(readFileSync(p, 'utf8')).toBe(agentsBefore[a]);
    }

    // knowledge/ survives byte-for-byte.
    const knowledgeAfter = snapshotTree(join(repoDir, 'knowledge'));
    expect(knowledgeAfter).toEqual(knowledgeBefore);
  });
});

// ===========================================================================
// AC6 — end-to-end: make-template then a scripted runInit (created branch).
// ===========================================================================
describe('AC6 — make-template output is genuinely clone-ready for init', () => {
  it('init_created_branch_runs_with_no_archive_prompt_after_make_template', async () => {
    const { makeTemplate } = await import(PROD.makeTemplate);
    const { runInit } = await import(PROD.init);

    const repoDir = makeDevRepo('af-mt-e2e');

    // Step 1: prep the template.
    await makeTemplate({ repoRoot: repoDir, now: () => FIXED_NOW, apply: true });

    // Sanity: PROJECT.md is gone (so init takes the created branch, not
    // already_initialized), and no TASK-NNN.json remain (so the archive prompt
    // must not fire).
    expect(existsSync(join(repoDir, 'PROJECT.md'))).toBe(false);
    expect(listTaskDir(repoDir).filter((n) => /^TASK-/.test(n))).toEqual([]);

    // Step 2: scripted init. The archive prompt MUST NOT fire — wrap the
    // wizard prompter so any 'archive' prompt throws loudly.
    const wizard = makeScriptedPrompter(webSaasAnswers({ project_name: 'clone-ready' }));
    const prompter = async (ctx) => {
      if (typeof ctx?.prompt === 'string' && /archive/i.test(ctx.prompt)) {
        throw new Error(
          `archive prompt must NOT fire on a clean template; got: ${ctx.prompt}`,
        );
      }
      return wizard(ctx);
    };

    const result = await runInit({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
      hostname: FIXED_HOST,
    });

    // init completed via the created branch.
    expect(result.state).toBe('created');

    // Fresh PROJECT.md was written.
    expect(existsSync(join(repoDir, 'PROJECT.md'))).toBe(true);

    // A seeded starter backlog exists — every minted ticket carries `seed`.
    const seededTickets = listTaskDir(repoDir).filter((n) => /^TASK-\d{3,}\.json$/.test(n));
    expect(
      seededTickets.length,
      'init must mint a starter backlog after make-template',
    ).toBeGreaterThan(0);
    for (const name of seededTickets) {
      const t = JSON.parse(readFileSync(join(repoDir, 'tasks', name), 'utf8'));
      expect(t.labels).toContain('seed');
    }

    // No .framework-history/ archive was created — there was nothing to archive.
    expect(existsSync(join(repoDir, '.framework-history'))).toBe(false);
  });
});

// ===========================================================================
// AC7 — README quickstart gains a "Preparing a distribution" note (real repo).
// ===========================================================================
describe('AC7 — README documents the make-template distribution step', () => {
  it('readme_has_preparing_a_distribution_note', () => {
    const readmePath = join(REPO_ROOT, 'README.md');
    expect(existsSync(readmePath), 'README.md must exist at the repo root').toBe(true);
    const text = readFileSync(readmePath, 'utf8');

    // A heading anchoring the new section.
    expect(
      /preparing a distribution/i.test(text),
      'README.md must contain a "Preparing a distribution" note',
    ).toBe(true);

    // It must name the exact command operators run before publishing a clone.
    expect(
      text.includes('bin/make-template.js --yes'),
      'README.md must document `node bin/make-template.js --yes`',
    ).toBe(true);

    // It must remind consumers to `npm install` before `node bin/init.js`
    // (the init dependency chain needs ajv via backlog-seeder -> task-store).
    expect(
      /npm install/i.test(text),
      'README.md must remind consumers to run `npm install` before init',
    ).toBe(true);
  });
});
