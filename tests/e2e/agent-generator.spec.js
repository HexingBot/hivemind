// tests/agent-generator.spec.js
// TASK-013 — src/agent-generator.js exposes generateProjectContext({repoRoot,
// answers, now}) and writes .claude/agents/project-context.md via atomicWriteFile.
// The four base agent files gain a "read project-context.md before starting"
// instruction. bin/init.js calls the generator after writeProjectMd in the
// created/forced branches; the already_initialized branch leaves any existing
// project-context.md untouched.
//
// Covers ACs 1-7 from TASK-013.

import { describe, it, expect, vi, afterAll, afterEach } from 'vitest';
import {
  readFileSync, writeFileSync, existsSync, mkdirSync,
} from 'node:fs';
import { join } from 'node:path';

import { PROD } from '../helpers/fixtures.js';
import { REPO_ROOT } from '../helpers/repoRoot.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { makeScriptedPrompter, webSaasAnswers } from '../helpers/scripted-prompter.js';

afterAll(cleanupAll);

const FIXED_NOW = '2026-05-27T12:00:00Z';
const PROJECT_CONTEXT_REL = join('.claude', 'agents', 'project-context.md');

// All six values in the frozen PROJECT_TYPES taxonomy. Kept inline to make this
// spec independent of question-library.js export shape — if the taxonomy ever
// changes underneath us, the AC3 loop fails loudly and the test must be
// updated in lockstep with the production map.
const ALL_TYPES = [
  'web-saas',
  'cli-tool',
  'data-pipeline',
  'ml-model',
  'library',
  'other',
];

// Per-type keyword expectations for AC3. At least ONE of the listed words must
// appear (case-insensitive) in the `## Type-specific guidance` body for that
// type. The disjunctive surface prevents a degenerate "same 3 bullets for
// every type" implementation while still tolerating wording variation.
const TYPE_KEYWORDS = {
  'web-saas': /browser|frontend|HTTP|routing/i,
  'cli-tool': /stdin|stdout|argv|exit code|TTY/i,
  'data-pipeline': /batch|stream|schema|throughput|idempot/i,
  'ml-model': /dataset|notebook|metric|reproducib|eval/i,
  'library': /API|semver|backwards|consumer|export/i,
  'other': /default|generic|conservative|unspecified/i,
};

// Minimal valid answers map for a given type. Frontmatter requires
// project_name + project_type; everything else is consumed by the various
// body sections so callers always include them in real intakes, but the
// generator should not blow up when type-specific keys are absent.
function answersForType(type, overrides = {}) {
  return {
    project_name: `p-${type}`,
    project_type: type,
    ...overrides,
  };
}

// ===========================================================================
// AC1 — module shape + answers injection bypasses the PROJECT.md read.
// ===========================================================================
describe('AC1 — generateProjectContext module shape', () => {
  it('writes_to_dot_claude_agents_project_context_md_via_answers_injection', async () => {
    const { generateProjectContext } = await import(PROD.agentGenerator);

    const repoDir = makeTmpDir('af-agen-shape');
    // Intentionally do NOT create PROJECT.md — answers injection should bypass
    // the readProjectMd path entirely.
    const result = await generateProjectContext({
      repoRoot: repoDir,
      answers: answersForType('web-saas'),
      now: () => FIXED_NOW,
    });

    expect(typeof result).toBe('object');
    expect(result).not.toBeNull();
    expect(typeof result.path).toBe('string');

    const expectedPath = join(repoDir, PROJECT_CONTEXT_REL);
    expect(result.path).toBe(expectedPath);
    expect(existsSync(expectedPath)).toBe(true);
  });

  it('reads_project_md_when_answers_is_omitted', async () => {
    const { generateProjectContext } = await import(PROD.agentGenerator);
    const { writeProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-agen-readsmd');
    await writeProjectMd({
      repoRoot: repoDir,
      answers: {
        project_name: 'pmd-sourced',
        project_type: 'library',
        project_description: 'sourced from disk',
        target_users: 'devs',
        success_criteria: 'works',
      },
      now: () => FIXED_NOW,
    });

    const result = await generateProjectContext({
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    expect(existsSync(result.path)).toBe(true);
    const text = readFileSync(result.path, 'utf8');
    // Frontmatter project_name must echo what readProjectMd sourced from disk.
    expect(text).toMatch(/^project_name:\s*pmd-sourced\s*$/m);
    expect(text).toMatch(/^project_type:\s*library\s*$/m);
  });
});

// ===========================================================================
// AC2 — frontmatter fields + body section heading order.
// ===========================================================================
describe('AC2 — generated file layout', () => {
  it('frontmatter_has_required_fields_and_body_headings_in_order', async () => {
    const { generateProjectContext } = await import(PROD.agentGenerator);

    const repoDir = makeTmpDir('af-agen-layout');
    const result = await generateProjectContext({
      repoRoot: repoDir,
      answers: answersForType('cli-tool', { project_name: 'layout-demo' }),
      now: () => FIXED_NOW,
    });

    const text = readFileSync(result.path, 'utf8');

    // Frontmatter fence + required keys.
    expect(text.startsWith('---\n')).toBe(true);
    expect(text).toMatch(/^project_name:\s*layout-demo\s*$/m);
    expect(text).toMatch(/^project_type:\s*cli-tool\s*$/m);
    expect(text).toMatch(/^generated_at:\s*\S+/m);
    expect(text).toMatch(/^schema_version:\s*1\s*$/m);

    // Closing fence appears.
    const lines = text.split('\n');
    expect(lines[0]).toBe('---');
    let closeIdx = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === '---') {
        closeIdx = i;
        break;
      }
    }
    expect(closeIdx, 'closing --- delimiter must be present').toBeGreaterThan(0);

    // Body section headings in the exact required order.
    const requiredHeadings = [
      '## Stack',
      '## Testing conventions',
      '## Linting and formatting',
      '## Type-specific guidance',
    ];
    const indices = requiredHeadings.map((h) => text.indexOf(h));
    for (let i = 0; i < requiredHeadings.length; i++) {
      expect(indices[i], `missing heading: ${requiredHeadings[i]}`).toBeGreaterThan(-1);
    }
    for (let i = 1; i < indices.length; i++) {
      expect(
        indices[i],
        `${requiredHeadings[i]} must appear after ${requiredHeadings[i - 1]}`,
      ).toBeGreaterThan(indices[i - 1]);
    }
  });
});

// ===========================================================================
// AC3 — every project_type produces a type-specific section with >=3 bullets
// and the bullet body mentions at least one type-relevant keyword.
// ===========================================================================
describe('AC3 — per-type guidance bullets', () => {
  it.each(ALL_TYPES)('type_specific_section_for_%s', async (type) => {
    const { generateProjectContext } = await import(PROD.agentGenerator);

    const repoDir = makeTmpDir(`af-agen-type-${type}`);
    const result = await generateProjectContext({
      repoRoot: repoDir,
      answers: answersForType(type),
      now: () => FIXED_NOW,
    });

    const text = readFileSync(result.path, 'utf8');

    // Slice out the `## Type-specific guidance` section: from the heading to
    // the next `## ` heading (or EOF).
    const headingIdx = text.indexOf('## Type-specific guidance');
    expect(headingIdx, `## Type-specific guidance missing for ${type}`).toBeGreaterThan(-1);

    const afterHeading = text.slice(headingIdx + '## Type-specific guidance'.length);
    const nextHeadingMatch = afterHeading.match(/\n## /);
    const sectionBody = nextHeadingMatch
      ? afterHeading.slice(0, nextHeadingMatch.index)
      : afterHeading;

    // At least 3 bullet lines (markdown `- ` prefix at line-start).
    const bulletLines = sectionBody
      .split('\n')
      .filter((ln) => /^- \S/.test(ln));
    expect(
      bulletLines.length,
      `${type}: expected at least 3 bullet lines in the type-specific section, got ${bulletLines.length}`,
    ).toBeGreaterThanOrEqual(3);

    // At least one type-relevant keyword in the section body.
    const keyword = TYPE_KEYWORDS[type];
    expect(
      sectionBody,
      `${type}: section body must mention one of ${keyword.source}`,
    ).toMatch(keyword);
  });
});

// ===========================================================================
// AC4 — bin/init.js integration (created branch + already_initialized branch).
// ===========================================================================
describe('AC4 — bin/init.js generates project-context.md', () => {
  it('created_branch_writes_project_context', async () => {
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-agen-init-created');
    const prompter = makeScriptedPrompter(webSaasAnswers({
      project_name: 'init-emits-ctx',
    }));

    const result = await runInit({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    expect(result.state).toBe('created');

    const ctxPath = join(repoDir, PROJECT_CONTEXT_REL);
    expect(existsSync(ctxPath), 'init should emit project-context.md').toBe(true);

    const text = readFileSync(ctxPath, 'utf8');
    // Scripted prompter answers `project_type: web-saas` — frontmatter must agree.
    expect(text).toMatch(/^project_type:\s*web-saas\s*$/m);
    expect(text).toMatch(/^project_name:\s*init-emits-ctx\s*$/m);
  });

  it('already_initialized_branch_does_not_regenerate', async () => {
    const { runInit } = await import(PROD.init);
    const { writeProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-agen-init-existing');
    // Pre-seed PROJECT.md so init takes the already_initialized branch.
    await writeProjectMd({
      repoRoot: repoDir,
      answers: {
        project_name: 'preexisting',
        project_type: 'cli-tool',
        project_description: 'd',
        target_users: 't',
        success_criteria: 's',
      },
      now: () => FIXED_NOW,
    });

    // Pre-seed project-context.md with a sentinel so we can detect regeneration.
    const ctxPath = join(repoDir, PROJECT_CONTEXT_REL);
    mkdirSync(join(repoDir, '.claude', 'agents'), { recursive: true });
    const sentinel = '## SENTINEL — must survive already_initialized init\n';
    writeFileSync(ctxPath, sentinel, 'utf8');

    const result = await runInit({
      argv: [],
      prompter: async () => {
        throw new Error('prompter should not be called in already_initialized branch');
      },
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    expect(result.state).toBe('already_initialized');
    expect(readFileSync(ctxPath, 'utf8')).toBe(sentinel);
  });
});

// ===========================================================================
// AC5 — base agent files mention .claude/agents/project-context.md.
//
// TASK-032 — orchestrator.md removed: the Orchestrator is the main session
// thread, not a spawnable subagent. The three specialist subagents (developer,
// reviewer, researcher) must still reference project-context.md in their
// Inputs section. The project-context.md sentence in src/agent-generator.js
// now patches only these three files.
// ===========================================================================
describe('AC5 — base agent files reference project-context.md', () => {
  const AGENT_FILES = ['developer.md', 'reviewer.md', 'researcher.md'];

  it.each(AGENT_FILES)('agent_file_%s_references_project_context', (filename) => {
    const path = join(REPO_ROOT, '.claude', 'agents', filename);
    expect(existsSync(path), `${filename} must exist`).toBe(true);
    const text = readFileSync(path, 'utf8');

    // Require the exact `.claude/agents/project-context.md` token to appear so a
    // stray mention of the bare filename in unrelated prose can't false-positive.
    expect(
      text,
      `${filename} must reference .claude/agents/project-context.md in its instructions`,
    ).toMatch(/\.claude\/agents\/project-context\.md/);
  });
});

// ===========================================================================
// AC6 — missing PROJECT.md error path.
// ===========================================================================
describe('AC6 — missing PROJECT.md error', () => {
  it('throws_named_file_error_when_project_md_absent_and_no_answers', async () => {
    const { generateProjectContext } = await import(PROD.agentGenerator);

    const repoDir = makeTmpDir('af-agen-no-pmd');
    // Empty repo, no PROJECT.md, no answers injection.
    await expect(
      generateProjectContext({
        repoRoot: repoDir,
        now: () => FIXED_NOW,
      }),
    ).rejects.toThrow(/PROJECT\.md/);
  });
});

// ===========================================================================
// AC7 — atomic write semantics (fsync precedes rename for project-context.md).
// ===========================================================================
describe('AC7 — atomic write invariant for project-context.md', () => {
  vi.mock('node:fs', async (importOriginal) => {
    const real = await importOriginal();
    return {
      ...real,
      openSync: vi.fn(real.openSync),
      writeSync: vi.fn(real.writeSync),
      fsyncSync: vi.fn(real.fsyncSync),
      closeSync: vi.fn(real.closeSync),
      renameSync: vi.fn(real.renameSync),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('generate_project_context_uses_atomic_write', async () => {
    const fs = await import('node:fs');
    const { generateProjectContext } = await import(PROD.agentGenerator);

    const repoDir = makeTmpDir('af-agen-atomic');
    const target = join(repoDir, PROJECT_CONTEXT_REL);

    await generateProjectContext({
      repoRoot: repoDir,
      answers: answersForType('ml-model', { project_name: 'atomic-ml' }),
      now: () => FIXED_NOW,
    });

    // At least one rename targeted project-context.md.
    const renamesToTarget = fs.renameSync.mock.calls.filter(
      ([, dst]) => dst === target,
    );
    expect(
      renamesToTarget.length,
      'expected rename(tmp, project-context.md) at least once',
    ).toBeGreaterThanOrEqual(1);

    // fsync precedes the first rename-to-target — the single-file atomic invariant.
    expect(fs.fsyncSync.mock.invocationCallOrder.length).toBeGreaterThan(0);
    expect(fs.renameSync.mock.invocationCallOrder.length).toBeGreaterThan(0);
    const lastFsync = Math.max(...fs.fsyncSync.mock.invocationCallOrder);
    const renamesToTargetOrders = fs.renameSync.mock.calls
      .map((call, idx) => ({ call, order: fs.renameSync.mock.invocationCallOrder[idx] }))
      .filter(({ call }) => call[1] === target)
      .map(({ order }) => order);
    const firstRenameToTarget = Math.min(...renamesToTargetOrders);
    expect(lastFsync).toBeLessThan(firstRenameToTarget);
  });
});
