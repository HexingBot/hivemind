// tests/init.spec.js
// TASK-012 — bin/init.js entrypoint, four-branch state machine, plus the
// CLAUDE.md "First-chat routing" amendment. Tests-first phase: every test in
// this file must FAIL on the baseline (bin/init.js missing; CLAUDE.md not yet
// amended). The impl phase will make them pass without modifying these tests.
//
// Branches under test:
//   1. already_initialized — PROJECT.md present, prompter MUST NOT be called.
//   2. forced               — PROJECT.md present + `--force`, wizard runs,
//                             new bundle created, PROJECT.md overwritten.
//   3. resumed              — partial intake.json present, PROJECT.md absent;
//                             prompter is NOT called for already-answered
//                             question ids; same bundle id is reused.
//   4. created              — fresh repo, startSession spins up a new bundle,
//                             intake.json + PROJECT.md both materialize.
//
// Plus three robustness tests: unknown-flag rejection, returned sessionId
// matches the pointer for the created branch, and a CLAUDE.md routing-section
// assertion that reads the REAL repo CLAUDE.md (not a tmpRepo copy).

import { describe, it, expect, afterAll } from 'vitest';
import {
  existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync,
} from 'node:fs';
import { join } from 'node:path';

import { PROD } from '../helpers/fixtures.js';
import { REPO_ROOT } from '../helpers/repoRoot.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { makeScriptedPrompter, webSaasAnswers } from '../helpers/scripted-prompter.js';

afterAll(cleanupAll);

const FIXED_NOW = '2026-05-26T12:00:00Z';
const FIXED_HOST = 'test-host';

// A prompter that throws if invoked. Used to assert "no prompting happened".
function throwIfCalled() {
  return async (ctx) => {
    throw new Error(
      `prompter was called unexpectedly with: ${JSON.stringify(ctx)}`,
    );
  };
}

function listSessionsDir(repoDir) {
  const dir = join(repoDir, 'state', 'sessions');
  if (!existsSync(dir)) return [];
  return readdirSync(dir);
}

function writeJson(target, payload) {
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

// ===========================================================================
// Branch 1 — already_initialized
// ===========================================================================
describe('AC2 — already_initialized branch', () => {
  it('already_initialized_when_project_md_exists', async () => {
    const { runInit } = await import(PROD.init);
    const { writeProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-init-ai');
    // Seed PROJECT.md with synthetic answers.
    await writeProjectMd({
      repoRoot: repoDir,
      answers: {
        project_name: 'pre-existing',
        project_type: 'web-saas',
        project_description: 'a pre-seeded project',
        target_users: 'me',
        primary_use_cases: ['automation'],
        success_criteria: 'works',
      },
      now: () => FIXED_NOW,
    });
    const projectMdPath = join(repoDir, 'PROJECT.md');
    const before = readFileSync(projectMdPath, 'utf8');

    const result = await runInit({
      argv: [],
      prompter: throwIfCalled(),
      repoRoot: repoDir,
      now: () => FIXED_NOW,
      hostname: FIXED_HOST,
    });

    expect(result.state).toBe('already_initialized');
    // PROJECT.md byte-content is unchanged.
    expect(readFileSync(projectMdPath, 'utf8')).toBe(before);
  });
});

// ===========================================================================
// Branch 2 — forced
// ===========================================================================
describe('AC3 — forced branch', () => {
  it('forced_overwrites_existing_project_md', async () => {
    const { runInit } = await import(PROD.init);
    const { writeProjectMd, readProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-init-forced');
    await writeProjectMd({
      repoRoot: repoDir,
      answers: {
        project_name: 'old-project',
        project_type: 'cli-tool',
        project_description: 'older seeded project',
        target_users: 'someone',
        primary_use_cases: ['automation'],
        success_criteria: 'works',
      },
      now: () => FIXED_NOW,
    });

    const bundlesBefore = listSessionsDir(repoDir).length;

    const prompter = makeScriptedPrompter(webSaasAnswers());
    const result = await runInit({
      argv: ['--force'],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
      hostname: FIXED_HOST,
    });

    expect(result.state).toBe('forced');
    const projectMdPath = join(repoDir, 'PROJECT.md');
    expect(existsSync(projectMdPath)).toBe(true);

    const reread = await readProjectMd({ repoRoot: repoDir });
    expect(reread.frontmatter.name).toBe('new-project');

    // A NEW session bundle was created by the forced run.
    const bundlesAfter = listSessionsDir(repoDir);
    expect(bundlesAfter.length).toBeGreaterThan(bundlesBefore);
  });
});

// ===========================================================================
// Branch 3 — resumed
// ===========================================================================
describe('AC4 — resumed branch', () => {
  it('resumed_from_partial_intake', async () => {
    const { runInit } = await import(PROD.init);
    const { readProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-init-resumed');

    // Seed an active session bundle on disk with a partial intake.json.
    // Three intake answers are already recorded (project_name, project_description,
    // project_type). TASK-046 reordered COMMON_QUESTIONS so discovery questions
    // (problem_statement, goals, scope_in, scope_out) now come first. TASK-048
    // made problem_statement required. Since the partial intake does NOT include
    // problem_statement, the engine will ask it on resume — remainingAnswers
    // supplies a non-empty value. goals/scope_in/scope_out remain optional so
    // makeScriptedPrompter returns '' for them (accepted as skips).
    const sessionId = '20260526T120000Z-abcdef01';
    const bundleDir = join(repoDir, 'state', 'sessions', sessionId);
    mkdirSync(bundleDir, { recursive: true });
    mkdirSync(join(repoDir, 'state'), { recursive: true });

    // Pointer
    writeJson(join(repoDir, 'state', 'session.json'), {
      schema_version: 2,
      active_session_id: sessionId,
      updated_at: FIXED_NOW,
    });
    // Bundle session.json — minimal active bundle
    writeJson(join(bundleDir, 'session.json'), {
      schema_version: 2,
      session_id: sessionId,
      lifecycle_state: 'active',
      updated_at: FIXED_NOW,
      active_task: null,
      workflow_step: 'idle',
      next_action: null,
      handoff_summary: 'seeded for init resume test',
      open_questions: [],
      blockers: [],
      decisions: [],
      subagent_results: [],
      pending_human_confirmation: null,
    });
    // Manifest — the bundle was opted in to nothing fancy
    writeJson(join(bundleDir, 'manifest.json'), {
      session_id: sessionId,
      schema_version: 1,
      created_at: FIXED_NOW,
      host: 'a'.repeat(64),
      snapshot_transcript: false,
      transcript_refs: [],
    });
    // Partial intake — first three common questions answered, three more
    // plus the web-saas branch still to go.
    writeJson(join(bundleDir, 'intake.json'), {
      answers: {
        project_name: 'partial',
        project_description: 'desc',
        project_type: 'web-saas',
      },
      lastAnsweredId: 'project_type',
    });

    const remainingAnswers = {
      // TASK-048 — problem_statement is now required; the partial intake above
      // did not include it, so the engine will ask it on resume.
      problem_statement: 'Context was lost mid-session.',
      target_users: 'people',
      primary_use_cases: 'automation',
      success_criteria: 'ships',
      frontend_framework: 'react',
      backend_framework: 'node-express',
      database: 'postgres',
      web_deployment_target: 'fly-io',
    };
    const prompter = makeScriptedPrompter(remainingAnswers);

    const result = await runInit({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
      hostname: FIXED_HOST,
    });

    expect(result.state).toBe('resumed');

    // Prompter MUST NOT have been called for the three already-answered ids.
    const asked = prompter.askedIds();
    expect(asked).not.toContain('project_name');
    expect(asked).not.toContain('project_description');
    expect(asked).not.toContain('project_type');

    // PROJECT.md ended up with the seeded name from the partial intake.
    const reread = await readProjectMd({ repoRoot: repoDir });
    expect(reread.frontmatter.name).toBe('partial');

    // SAME bundle reused — no new bundle directory.
    expect(listSessionsDir(repoDir)).toEqual([sessionId]);
  });
});

// ===========================================================================
// Branch 4 — created
// ===========================================================================
describe('AC5 — created branch', () => {
  it('created_from_empty_repo', async () => {
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-init-created');
    // Note: NO PROJECT.md, NO state/session.json. Wide open.

    const prompter = makeScriptedPrompter(webSaasAnswers({
      project_name: 'fresh-project',
    }));

    const result = await runInit({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
      hostname: FIXED_HOST,
    });

    expect(result.state).toBe('created');
    expect(typeof result.sessionId).toBe('string');
    expect(result.sessionId.length).toBeGreaterThan(0);

    // Pointer file now exists and points at the returned sessionId.
    const pointerPath = join(repoDir, 'state', 'session.json');
    expect(existsSync(pointerPath)).toBe(true);
    const pointer = JSON.parse(readFileSync(pointerPath, 'utf8'));
    expect(pointer.active_session_id).toBe(result.sessionId);

    // intake.json lives in the bundle and its answers mirror PROJECT.md
    // frontmatter for the project_name we scripted.
    const intakePath = join(repoDir, 'state', 'sessions', result.sessionId, 'intake.json');
    expect(existsSync(intakePath)).toBe(true);
    const intake = JSON.parse(readFileSync(intakePath, 'utf8'));
    expect(intake.answers.project_name).toBe('fresh-project');
    expect(intake.answers.project_type).toBe('web-saas');

    // PROJECT.md is at the repo root.
    expect(existsSync(join(repoDir, 'PROJECT.md'))).toBe(true);

    // manifest.json was created by startSession.
    const manifestPath = join(repoDir, 'state', 'sessions', result.sessionId, 'manifest.json');
    expect(existsSync(manifestPath)).toBe(true);
  });
});

// ===========================================================================
// AC8 — unknown flag rejection
// ===========================================================================
describe('AC8 — flag parsing', () => {
  it('unknown_flag_throws_with_flag_name', async () => {
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-init-bogus');

    await expect(
      runInit({
        argv: ['--bogus-flag'],
        prompter: throwIfCalled(),
        repoRoot: repoDir,
        now: () => FIXED_NOW,
        hostname: FIXED_HOST,
      }),
    ).rejects.toThrow(/--bogus-flag/);
  });
});

// ===========================================================================
// Robustness — sessionId returned for `created` matches the pointer.
// ===========================================================================
describe('AC1 — returned sessionId tracks the pointer', () => {
  it('returned_session_id_matches_pointer_for_created', async () => {
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-init-ptr-match');
    const prompter = makeScriptedPrompter(webSaasAnswers());

    const result = await runInit({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
      hostname: FIXED_HOST,
    });

    expect(result.state).toBe('created');
    const pointer = JSON.parse(
      readFileSync(join(repoDir, 'state', 'session.json'), 'utf8'),
    );
    expect(pointer.active_session_id).toBe(result.sessionId);
  });
});

// ===========================================================================
// AC6 — CLAUDE.md amendment (real repo, not tmpRepo).
// ===========================================================================
describe('AC6 — CLAUDE.md first-chat routing', () => {
  it('claude_md_has_first_chat_routing_above_resume_first', () => {
    const claudeMdPath = join(REPO_ROOT, 'CLAUDE.md');
    expect(existsSync(claudeMdPath), 'CLAUDE.md must exist at the repo root').toBe(true);
    const text = readFileSync(claudeMdPath, 'utf8');

    // Heading match — exact `## First-chat routing` at line-start. Trailing
    // whitespace (a stray space before the newline) tolerated by the regex.
    const headingRegex = /^## First-chat routing\s*$/m;
    const headingMatch = text.match(headingRegex);
    expect(headingMatch, 'CLAUDE.md must contain a `## First-chat routing` heading').not.toBeNull();
    const firstChatIdx = headingMatch.index;

    // RESUME FIRST heading — current canonical wording in CLAUDE.md is
    // `## RESUME FIRST (do this before anything else in every new chat)`.
    // We match the prefix only so wordsmithing of the parenthetical doesn't
    // break the ordering check.
    const resumeRegex = /^## RESUME FIRST\b.*$/m;
    const resumeMatch = text.match(resumeRegex);
    expect(resumeMatch, 'CLAUDE.md must contain a `## RESUME FIRST` heading').not.toBeNull();
    const resumeIdx = resumeMatch.index;

    // Order: First-chat routing must appear textually BEFORE RESUME FIRST.
    expect(firstChatIdx).toBeLessThan(resumeIdx);

    // Section body — the slice between the two H2s must mention both literal
    // anchors that humans/orchestrators key off of.
    const sectionBody = text.slice(firstChatIdx, resumeIdx);
    expect(sectionBody).toContain('PROJECT.md');
    expect(sectionBody).toContain('bin/init.js');
  });
});

// ===========================================================================
// TASK-015 AC6 — argv strictness regression: positional tokens (anything not
// in KNOWN_FLAGS, including non-`--` tokens) must throw with the offending
// token named in the message. Mirrors bin/new-task.js's existing behavior.
// ===========================================================================
describe('TASK-015 AC6 — argv strict-positional rejection', () => {
  it('unknown_positional_token_throws_with_token_name', async () => {
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-init-strict-positional');

    // No leading `--` — this is a positional token. Pre-TASK-015 behavior
    // silently dropped it; TASK-015 requires it surface as an error naming
    // the offending token. Choose a token that is also NOT a valid flag.
    await expect(
      runInit({
        argv: ['stray-positional'],
        prompter: throwIfCalled(),
        repoRoot: repoDir,
        now: () => FIXED_NOW,
        hostname: FIXED_HOST,
      }),
    ).rejects.toThrow(/stray-positional/);
  });

  it('no_archive_is_a_recognized_flag_not_a_stray_positional', async () => {
    // After TASK-015 adds --no-archive to KNOWN_FLAGS, passing it on an
    // empty repo must NOT throw an "unknown flag" error. This guard
    // exists so the impl can't accidentally regress AC3 (--no-archive
    // suppresses the prompt) by leaving --no-archive out of KNOWN_FLAGS.
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-init-no-archive-known');
    const prompter = makeScriptedPrompter(webSaasAnswers());

    const result = await runInit({
      argv: ['--no-archive'],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
      hostname: FIXED_HOST,
    });

    // Fresh repo with no framework history — branch is `created`, --no-archive
    // is irrelevant here, but the flag MUST be accepted without complaint.
    expect(result.state).toBe('created');
  });
});

// ===========================================================================
// TASK-015 AC7d/AC7e/AC7f — bin/init.js integration with framework-history
// archive. Three scenarios:
//   d. created + framework history + default-Y (empty input) → archive runs.
//   e. --no-archive suppresses the prompt and leaves tasks/ untouched.
//   f. forced branch (PROJECT.md exists, --force passed) does NOT archive.
// ===========================================================================
describe('TASK-015 AC7d — created branch archives on default-Y prompt', () => {
  it('created_branch_archives_framework_history_when_user_confirms', async () => {
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-init-archive-default-y');
    // Seed framework history: three tickets, none labeled `seed`.
    const tasksDir = join(repoDir, 'tasks');
    mkdirSync(tasksDir, { recursive: true });
    for (const k of ['TASK-001', 'TASK-002', 'TASK-003']) {
      writeFileSync(
        join(tasksDir, `${k}.json`),
        JSON.stringify({
          key: k,
          title: `Synthetic ${k}`,
          description: 'framework history',
          acceptance_criteria: ['x'],
          status: 'todo',
          priority: 'medium',
          labels: ['framework'],
          assignee: null,
          depends_on: [],
          linked_commits: [],
          linked_prs: [],
          comments: [],
          created_at: '2026-05-27T00:00:00Z',
          updated_at: '2026-05-27T00:00:00Z',
          jira_key: null,
        }, null, 2),
        'utf8',
      );
    }

    // The prompter answers the framework-history archive prompt with empty
    // string (default-Y). The scripted-prompter resolves by matching
    // ctx.prompt against PROMPT_SIGNATURES; the archive prompt has no
    // signature there, so we wrap with our own router: anything whose prompt
    // text contains the literal 'Archive' returns empty string; everything
    // else falls through to the wizard's scripted answers.
    const wizard = makeScriptedPrompter(webSaasAnswers({
      project_name: 'fresh-after-archive',
    }));
    const prompter = async (ctx) => {
      if (typeof ctx?.prompt === 'string' && /archive/i.test(ctx.prompt)) {
        return ''; // empty input → default Y
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

    expect(result.state).toBe('created');

    // tasks/ no longer contains the framework-history tickets — they were
    // moved to .framework-history/tasks/ before the seeder ran.
    const archiveDir = join(repoDir, '.framework-history', 'tasks');
    expect(existsSync(archiveDir)).toBe(true);
    const archivedNames = readdirSync(archiveDir)
      .filter((n) => /^TASK-\d{3,}\.json$/.test(n))
      .sort();
    expect(archivedNames).toEqual(['TASK-001.json', 'TASK-002.json', 'TASK-003.json']);

    // The post-archive seeder still ran — fresh seed tickets exist under
    // tasks/ and they carry the `seed` label (the only labels present).
    const remainingTaskFiles = readdirSync(join(repoDir, 'tasks'))
      .filter((n) => /^TASK-\d{3,}\.json$/.test(n));
    expect(
      remainingTaskFiles.length,
      'seeder must run after archive in the created branch',
    ).toBeGreaterThan(0);
    for (const name of remainingTaskFiles) {
      const t = JSON.parse(readFileSync(join(repoDir, 'tasks', name), 'utf8'));
      expect(t.labels).toContain('seed');
    }
  });
});

describe('TASK-015 AC7e — --no-archive suppresses the prompt and the move', () => {
  it('no_archive_flag_leaves_framework_tickets_in_place', async () => {
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-init-no-archive');
    const tasksDir = join(repoDir, 'tasks');
    mkdirSync(tasksDir, { recursive: true });
    for (const k of ['TASK-001', 'TASK-002']) {
      writeFileSync(
        join(tasksDir, `${k}.json`),
        JSON.stringify({
          key: k,
          title: `Synthetic ${k}`,
          description: 'framework history',
          acceptance_criteria: ['x'],
          status: 'todo',
          priority: 'medium',
          labels: ['framework'],
          assignee: null,
          depends_on: [],
          linked_commits: [],
          linked_prs: [],
          comments: [],
          created_at: '2026-05-27T00:00:00Z',
          updated_at: '2026-05-27T00:00:00Z',
          jira_key: null,
        }, null, 2),
        'utf8',
      );
    }

    // Use a prompter that throws if the archive prompt fires — proves the
    // flag suppresses the prompt entirely rather than auto-answering.
    const wizard = makeScriptedPrompter(webSaasAnswers());
    const prompter = async (ctx) => {
      if (typeof ctx?.prompt === 'string' && /archive/i.test(ctx.prompt)) {
        throw new Error(
          `--no-archive must suppress the archive prompt entirely; got prompt: ${ctx.prompt}`,
        );
      }
      return wizard(ctx);
    };

    const result = await runInit({
      argv: ['--no-archive'],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
      hostname: FIXED_HOST,
    });

    expect(result.state).toBe('created');

    // No archive directory was created.
    expect(existsSync(join(repoDir, '.framework-history'))).toBe(false);

    // The framework-history tickets still sit under tasks/ untouched.
    for (const k of ['TASK-001', 'TASK-002']) {
      expect(
        existsSync(join(repoDir, 'tasks', `${k}.json`)),
        `${k} must remain in tasks/ when --no-archive is passed`,
      ).toBe(true);
    }
  });
});

describe('TASK-015 AC7f — forced branch does NOT trigger archive', () => {
  it('forced_branch_leaves_existing_tasks_untouched', async () => {
    const { runInit } = await import(PROD.init);
    const { writeProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-init-forced-no-archive');
    // PROJECT.md exists → with --force, the branch is `forced`, not `created`.
    await writeProjectMd({
      repoRoot: repoDir,
      answers: {
        project_name: 'pre-existing',
        project_type: 'web-saas',
        project_description: 'd',
        target_users: 't',
        primary_use_cases: ['automation'],
        success_criteria: 's',
      },
      now: () => FIXED_NOW,
    });
    // Seed framework history so a misbehaving `forced` branch would have
    // something to move. AC7f says it must NOT move them.
    const tasksDir = join(repoDir, 'tasks');
    mkdirSync(tasksDir, { recursive: true });
    for (const k of ['TASK-001', 'TASK-002']) {
      writeFileSync(
        join(tasksDir, `${k}.json`),
        JSON.stringify({
          key: k,
          title: `Synthetic ${k}`,
          description: 'framework history',
          acceptance_criteria: ['x'],
          status: 'todo',
          priority: 'medium',
          labels: ['framework'],
          assignee: null,
          depends_on: [],
          linked_commits: [],
          linked_prs: [],
          comments: [],
          created_at: '2026-05-27T00:00:00Z',
          updated_at: '2026-05-27T00:00:00Z',
          jira_key: null,
        }, null, 2),
        'utf8',
      );
    }

    // Archive prompt MUST NOT fire in the forced branch — throw if it does.
    const wizard = makeScriptedPrompter(webSaasAnswers());
    const prompter = async (ctx) => {
      if (typeof ctx?.prompt === 'string' && /archive/i.test(ctx.prompt)) {
        throw new Error(
          `forced branch must not trigger the archive prompt; got: ${ctx.prompt}`,
        );
      }
      return wizard(ctx);
    };

    const result = await runInit({
      argv: ['--force'],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
      hostname: FIXED_HOST,
    });

    expect(result.state).toBe('forced');

    // No archive directory was created.
    expect(existsSync(join(repoDir, '.framework-history'))).toBe(false);

    // The pre-existing framework-history tickets are still under tasks/.
    // (The seeder also skips because they carry no `seed` label — wait,
    // actually the seeder mints regardless if no existing ticket carries
    // `seed`. The framework-history tickets don't have `seed`, so the
    // seeder WILL run and mint new tickets too. We only assert the
    // pre-existing two survive untouched.)
    for (const k of ['TASK-001', 'TASK-002']) {
      expect(
        existsSync(join(repoDir, 'tasks', `${k}.json`)),
        `${k} must remain in tasks/ in the forced branch`,
      ).toBe(true);
    }
  });
});

// ===========================================================================
// AC1 — engine-shape prompter is what reaches the wizard.
// ===========================================================================
describe('AC1 — prompter contract', () => {
  it('prompter_signature_is_engine_shape', async () => {
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-init-shape');

    // The scripted prompter already enforces engine-shape (`ctx.prompt`
    // string + question-id resolution). To make the contract assertion
    // explicit, wrap it with a guard that records every ctx we saw.
    const inner = makeScriptedPrompter(webSaasAnswers());
    const seenCtxKeys = [];
    const prompter = async (ctx) => {
      seenCtxKeys.push(Object.keys(ctx).sort());
      // Engine-shape contract: ctx is an object with at least `prompt` and `type`.
      if (typeof ctx !== 'object' || ctx === null) {
        throw new Error(`prompter received non-object: ${typeof ctx}`);
      }
      if (typeof ctx.prompt !== 'string') {
        throw new Error(`prompter ctx.prompt must be a string, got ${typeof ctx.prompt}`);
      }
      if (typeof ctx.type !== 'string') {
        throw new Error(`prompter ctx.type must be a string, got ${typeof ctx.type}`);
      }
      return inner(ctx);
    };

    const result = await runInit({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
      hostname: FIXED_HOST,
    });

    expect(result.state).toBe('created');
    // At least one prompt was issued AND every ctx had both required keys.
    expect(seenCtxKeys.length).toBeGreaterThan(0);
    for (const keys of seenCtxKeys) {
      expect(keys).toContain('prompt');
      expect(keys).toContain('type');
    }
  });
});
