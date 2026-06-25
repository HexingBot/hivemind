// tests/init-command.spec.js
// TASK-024 — Plugin chain P4: the /hivemind:init-project bootstrap
// slash command + the non-interactive answers path that makes it work.
//
// Authoritative design: tasks/TASK-020.research.md §C (orchestrator activation)
// and §D.5 (the proof-of-load inventory nuance — `commands/*.md` surfaced under
// the "Skills" bucket in `claude plugin details`, but `/af-proof:ping` still
// registered + responded; so commands/ IS the correct authored form and the
// bucket label is cosmetic).
//
// THE DESIGN PROBLEM: a Claude Code slash command runs through the Bash tool,
// which has no interactive TTY stdin — it CANNOT drive runInit's readline
// prompter. So init needs a NON-INTERACTIVE path: Claude gathers the intake
// answers conversationally, writes them to a JSON file, and runs the bundled
// self-contained entry against the user's project with NO prompting.
//
// PINNED MECHANISM (testable + Bash-tool-compatible):
//   • runInit gains an optional `answers` object. When supplied, it SKIPS the
//     interactive runQuestionnaire entirely and materializes the project
//     straight from those answers (writeProjectMd + generateProjectContext +
//     seedBacklog). The prompter is NEVER called in this mode.
//   • The CLI shell gains `--answers-file <path>`: read+JSON.parse the file and
//     pass it as `answers`. This is what commands/init-project.md invokes:
//       node ${CLAUDE_PLUGIN_ROOT}/dist/init.cjs --answers-file <tmp>
//     against the user's project (resolveRepoRoot(process.env, process.cwd())).
//   • The existing interactive readline path stays for direct `node bin/init.js`.
//
// The programmatic `runInit({answers})` surface is the deterministic stand-in
// for the live E2E (AC4) — same artifacts, same target-dir invariant, no TTY.
//
// TESTS-FIRST: no impl exists yet — commands/init-project.md is absent and
// runInit has no `answers` mode (it will try to call the prompter, which we
// assert MUST NOT happen). Each spec below FAILS for the RIGHT reason
// (file-absent / prompter-called / artifacts-missing), never on a typo here.

import { describe, it, expect, afterAll } from 'vitest';
import {
  existsSync, readFileSync, readdirSync,
} from 'node:fs';
import { join } from 'node:path';

import { PROD } from '../helpers/fixtures.js';
import { REPO_ROOT } from '../helpers/repoRoot.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { webSaasAnswers } from '../helpers/scripted-prompter.js';

afterAll(cleanupAll);

const FIXED_NOW = '2026-05-28T12:00:00Z';

const COMMAND_FILE = join(REPO_ROOT, 'commands', 'init-project.md');

// A prompter that throws if invoked — proves the non-interactive answers path
// does NO prompting (the whole point of the Bash-tool-compatible mode).
function throwIfCalled() {
  return async (ctx) => {
    throw new Error(`prompter was called unexpectedly with: ${JSON.stringify(ctx)}`);
  };
}

function listSessions(repoDir) {
  const dir = join(repoDir, 'state', 'sessions');
  return existsSync(dir) ? readdirSync(dir) : [];
}

function listTaskFiles(repoDir) {
  const dir = join(repoDir, 'tasks');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => /^TASK-\d{3,}\.json$/.test(n));
}

/** Parse a frontmatter block out of a .md file: the text between the first two
 *  `---` fences. Returns the raw block (or '' if none). */
function frontmatterOf(mdText) {
  const m = mdText.match(/^---\s*\n([\s\S]*?)\n---\s*(\n|$)/);
  return m ? m[1] : '';
}

// ===========================================================================
// AC2 — the command file exists with registering frontmatter.
// §D.5: a `commands/*.md` with a `description` frontmatter key registered the
// slash command (it appeared under the "Skills" bucket but `/ns:name` worked).
// So we assert commands/init-project.md exists and carries a non-empty
// `description:` line in its frontmatter.
// FAILS NOW: commands/init-project.md does not exist.
// ===========================================================================
describe('AC2 — commands/init-project.md exists and registers the command', () => {
  it('command_file_exists', () => {
    expect(
      existsSync(COMMAND_FILE),
      'commands/init-project.md must exist (the /hivemind:init-project entrypoint)',
    ).toBe(true);
  });

  it('command_file_has_frontmatter_with_a_description', () => {
    expect(existsSync(COMMAND_FILE)).toBe(true);
    const text = readFileSync(COMMAND_FILE, 'utf8');
    const fm = frontmatterOf(text);
    expect(fm.length, 'command file must open with a --- frontmatter block').toBeGreaterThan(0);
    expect(
      /^description:\s*\S+/m.test(fm),
      'frontmatter must carry a non-empty `description:` so the command registers (§D.5)',
    ).toBe(true);
  });

  it('command_body_invokes_the_bundled_self_contained_entry_with_answers_file', () => {
    // The body must instruct running the SHIPPED bundle (dist/init.cjs) — not the
    // raw bin/init.js source — via the non-interactive --answers-file flag, using
    // ${CLAUDE_PLUGIN_ROOT} for the plugin's own code.
    const text = readFileSync(COMMAND_FILE, 'utf8');
    expect(
      text.includes('${CLAUDE_PLUGIN_ROOT}') && /dist\/init\.cjs/.test(text),
      'command body must run ${CLAUDE_PLUGIN_ROOT}/dist/init.cjs (the bundled entry)',
    ).toBe(true);
    expect(
      /--answers-file/.test(text),
      'command body must invoke the non-interactive --answers-file mode',
    ).toBe(true);
  });
});

// ===========================================================================
// AC1 (core) — non-interactive answers mode produces every artifact in the
// TARGET project dir, with NO prompting.
// FAILS NOW: runInit has no `answers` mode, so it falls into the created branch
// and calls the prompter → throwIfCalled() throws → the run rejects.
// ===========================================================================
describe('AC1 — non-interactive answers mode materializes the project', () => {
  it('answers_mode_writes_all_artifacts_without_prompting', async () => {
    const { runInit } = await import(PROD.init);
    const repoDir = makeTmpDir('af-initcmd-answers');

    const result = await runInit({
      argv: [],
      answers: webSaasAnswers({ project_name: 'cmd-bootstrap' }),
      prompter: throwIfCalled(), // must NOT be called in answers mode
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    // A fresh dir → a created-style materialization.
    expect(['created', 'forced']).toContain(result.state);
    expect(typeof result.sessionId).toBe('string');
    expect(result.sessionId.length).toBeGreaterThan(0);

    // 1) PROJECT.md under the target dir.
    expect(existsSync(join(repoDir, 'PROJECT.md')), 'PROJECT.md must be written').toBe(true);

    // 2) .claude/agents/project-context.md under the target dir.
    expect(
      existsSync(join(repoDir, '.claude', 'agents', 'project-context.md')),
      'project-context.md must be generated',
    ).toBe(true);

    // 3) a seeded backlog (TASK-NNN.json files) under the target dir.
    expect(
      listTaskFiles(repoDir).length,
      'a starter backlog must be seeded',
    ).toBeGreaterThan(0);

    // 4) a session bundle (pointer + bundle dir) under the target dir.
    expect(existsSync(join(repoDir, 'state', 'session.json')), 'pointer must exist').toBe(true);
    expect(listSessions(repoDir)).toContain(result.sessionId);
    expect(
      existsSync(join(repoDir, 'state', 'sessions', result.sessionId, 'manifest.json')),
      'bundle manifest must exist',
    ).toBe(true);
  });

  it('answers_mode_writes_project_md_matching_the_supplied_answers', async () => {
    const { runInit } = await import(PROD.init);
    const { readProjectMd } = await import(PROD.projectMd);
    const repoDir = makeTmpDir('af-initcmd-roundtrip');

    await runInit({
      argv: [],
      answers: webSaasAnswers({ project_name: 'from-answers', project_type: 'web-saas' }),
      prompter: throwIfCalled(),
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    const { frontmatter } = await readProjectMd({ repoRoot: repoDir });
    expect(frontmatter.name).toBe('from-answers');
    expect(frontmatter.type).toBe('web-saas');
  });
});

// ===========================================================================
// AC4 (target-dir invariant) — answers-mode writes to the PASSED repoRoot, not
// to the bundle's own location or to process.cwd(). We run two inits into two
// distinct temp dirs and assert each artifact lands in its own dir and the
// other dir is untouched (no cross-write to a shared/plugin location).
// FAILS NOW: same reason — no answers mode.
// ===========================================================================
describe('AC4 — artifacts land in the target repoRoot, not elsewhere', () => {
  it('answers_mode_targets_the_passed_repoRoot_only', async () => {
    const { runInit } = await import(PROD.init);
    const repoA = makeTmpDir('af-initcmd-tgtA');
    const repoB = makeTmpDir('af-initcmd-tgtB');

    await runInit({
      argv: [],
      answers: webSaasAnswers({ project_name: 'target-A' }),
      prompter: throwIfCalled(),
      repoRoot: repoA,
      now: () => FIXED_NOW,
    });

    // A got the artifacts.
    expect(existsSync(join(repoA, 'PROJECT.md'))).toBe(true);
    // B is pristine — the write did not leak to another root or to the REPO_ROOT.
    expect(existsSync(join(repoB, 'PROJECT.md'))).toBe(false);
    expect(existsSync(join(repoB, 'tasks'))).toBe(false);
    expect(existsSync(join(repoB, 'state', 'session.json'))).toBe(false);
  });
});

// ===========================================================================
// AC3 — idempotency. A second answers-mode run on an already-initialized
// project does NOT clobber: it honors the PROJECT.md guard (state becomes
// already_initialized, no prompting, no overwrite) and the seed-label backlog
// guard (no duplicate seed tickets).
// FAILS NOW: no answers mode for the first run to even reach this state.
// ===========================================================================
describe('AC3 — re-run is idempotent (no clobber)', () => {
  it('second_answers_run_is_already_initialized_and_does_not_duplicate_backlog', async () => {
    const { runInit } = await import(PROD.init);
    const repoDir = makeTmpDir('af-initcmd-idem');

    // First run materializes the project.
    const first = await runInit({
      argv: [],
      answers: webSaasAnswers({ project_name: 'idem-once' }),
      prompter: throwIfCalled(),
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });
    expect(['created', 'forced']).toContain(first.state);

    const projectMdBefore = readFileSync(join(repoDir, 'PROJECT.md'), 'utf8');
    const backlogBefore = listTaskFiles(repoDir).sort();
    expect(backlogBefore.length).toBeGreaterThan(0);

    // Second run with answers but NO --force: the PROJECT.md guard must win.
    const second = await runInit({
      argv: [],
      answers: webSaasAnswers({ project_name: 'idem-twice-SHOULD-NOT-APPLY' }),
      prompter: throwIfCalled(),
      repoRoot: repoDir,
      now: () => '2026-05-28T13:00:00Z',
    });

    expect(second.state).toBe('already_initialized');

    // PROJECT.md untouched (the second run's different name did not overwrite).
    expect(readFileSync(join(repoDir, 'PROJECT.md'), 'utf8')).toBe(projectMdBefore);

    // Backlog not duplicated (seed-label guard).
    expect(listTaskFiles(repoDir).sort()).toEqual(backlogBefore);
  });
});

// ===========================================================================
// MANUAL CLI SENSOR — AC1/AC2 live-registration proof. Like the plugin-scaffold
// manual sensor: `claude plugin details` mutates the user's real plugin config
// and a live `/command` invocation is not vitest-automatable. The impl phase /
// reviewer runs the sequence below by hand and pastes the observed inventory.
//
//   claude plugin marketplace add C:\Users\srpar\OneDrive\Documents\hivemind
//   claude plugin install hivemind@hivemind-marketplace
//   claude plugin details hivemind
//     # EXPECT: an init-project entry appears (per §D.5 it may surface under the
//     #         "Skills" bucket rather than a separate "Commands" bucket — that
//     #         is the documented cosmetic nuance; what matters is it registers).
//   # then, inside `claude`, run:  /hivemind:init-project
//     # EXPECT: Claude asks the intake questions, writes an answers JSON, and
//     #         runs node ${CLAUDE_PLUGIN_ROOT}/dist/init.cjs --answers-file <tmp>
//     #         against ${CLAUDE_PROJECT_DIR}; PROJECT.md + project-context.md +
//     #         seeded backlog + session bundle appear in the PROJECT dir, and
//     #         the plugin cache dir is NOT mutated.
//   claude plugin uninstall hivemind
//   claude plugin marketplace remove hivemind-marketplace
describe('AC1/AC2 — claude CLI command registration (MANUAL sensor)', () => {
  it.skip('init_project_registers_and_runs_see_comment_above', () => {
    // Deliberately not automated — see the command manifesto above. The reviewer
    // executes it and records the observed `plugin details` inventory bucket.
  });
});
