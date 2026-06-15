// tests/e2e/project-definition-sections.spec.js
// TASK-045 — PROJECT.md definition sections: problem, goals, scope (in/out).
//
// Covers ACs 2, 3, 4, 5 (AC1 is in the fast tier: tests/project-definition-schema.spec.js).
//
//   AC2 — writeProjectMd renders the new definition sections as body prose/
//          bullets in a fixed documented order AFTER existing sections and BEFORE
//          ## Stack. Sections are OMITTED ENTIRELY when the field is absent OR empty.
//
//   AC3 — readProjectMd round-trips the new sections losslessly, including list
//          items containing commas/punctuation (bullet encoding, not inline arrays).
//
//   AC4 — Back-compat: a PROJECT.md written WITHOUT new sections reads back with
//          problem_statement/goals/scope_in/scope_out all undefined. Existing
//          fields are unchanged.
//
//   AC5 — generateProjectContext surfaces the definition block in
//          .claude/agents/project-context.md. When fields are absent the section
//          is omitted and no crash occurs.

import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PROD } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

const FIXED_NOW = '2026-05-26T12:00:00Z';

// Minimal valid base answers (no new fields) used across multiple tests.
function baseAnswers(overrides = {}) {
  return {
    project_name: 'def-sections-demo',
    project_type: 'cli-tool',
    project_description: 'A project to test definition sections.',
    target_users: 'framework developers',
    success_criteria: 'all ACs pass',
    frontend_framework: 'React',
    backend_framework: 'Node',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AC2 — rendering order and omission logic
// ---------------------------------------------------------------------------

describe('TASK-045 AC2 — writeProjectMd renders definition sections in fixed order', () => {
  it('renders_problem_section_with_heading_Problem', async () => {
    const { writeProjectMd, readProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-def-ac2-problem');
    await writeProjectMd({
      repoRoot: repoDir,
      answers: baseAnswers({
        problem_statement: 'Teams lose context when switching between long-running projects.',
      }),
      now: () => FIXED_NOW,
    });

    const text = readFileSync(join(repoDir, 'PROJECT.md'), 'utf8');
    expect(text).toMatch(/^## Problem$/m);
    expect(text).toContain('Teams lose context when switching between long-running projects.');
  });

  it('renders_goals_section_as_bullet_list', async () => {
    const { writeProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-def-ac2-goals');
    await writeProjectMd({
      repoRoot: repoDir,
      answers: baseAnswers({
        goals: ['reduce onboarding time', 'improve knowledge retention'],
      }),
      now: () => FIXED_NOW,
    });

    const text = readFileSync(join(repoDir, 'PROJECT.md'), 'utf8');
    expect(text).toMatch(/^## Goals$/m);
    expect(text).toMatch(/^- reduce onboarding time$/m);
    expect(text).toMatch(/^- improve knowledge retention$/m);
  });

  it('renders_scope_in_section_as_bullet_list', async () => {
    const { writeProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-def-ac2-scopein');
    await writeProjectMd({
      repoRoot: repoDir,
      answers: baseAnswers({
        scope_in: ['project intake wizard', 'agent briefing generation'],
      }),
      now: () => FIXED_NOW,
    });

    const text = readFileSync(join(repoDir, 'PROJECT.md'), 'utf8');
    expect(text).toMatch(/^## Scope \(in\)$/m);
    expect(text).toMatch(/^- project intake wizard$/m);
    expect(text).toMatch(/^- agent briefing generation$/m);
  });

  it('renders_scope_out_section_as_bullet_list', async () => {
    const { writeProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-def-ac2-scopeout');
    await writeProjectMd({
      repoRoot: repoDir,
      answers: baseAnswers({
        scope_out: ['deployment tooling', 'CI/CD pipeline management'],
      }),
      now: () => FIXED_NOW,
    });

    const text = readFileSync(join(repoDir, 'PROJECT.md'), 'utf8');
    expect(text).toMatch(/^## Scope \(out\)$/m);
    expect(text).toMatch(/^- deployment tooling$/m);
    expect(text).toMatch(/^- CI\/CD pipeline management$/m);
  });

  it('definition_sections_appear_before_Stack_section', async () => {
    const { writeProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-def-ac2-order');
    await writeProjectMd({
      repoRoot: repoDir,
      answers: baseAnswers({
        problem_statement: 'The problem.',
        goals: ['goal one', 'goal two'],
        scope_in: ['scope in item'],
        scope_out: ['scope out item'],
      }),
      now: () => FIXED_NOW,
    });

    const text = readFileSync(join(repoDir, 'PROJECT.md'), 'utf8');

    // All four headings plus Stack must be present.
    const problemIdx = text.indexOf('## Problem');
    const goalsIdx = text.indexOf('## Goals');
    const scopeInIdx = text.indexOf('## Scope (in)');
    const scopeOutIdx = text.indexOf('## Scope (out)');
    const stackIdx = text.indexOf('## Stack');

    expect(problemIdx, '## Problem must be present').toBeGreaterThan(-1);
    expect(goalsIdx, '## Goals must be present').toBeGreaterThan(-1);
    expect(scopeInIdx, '## Scope (in) must be present').toBeGreaterThan(-1);
    expect(scopeOutIdx, '## Scope (out) must be present').toBeGreaterThan(-1);
    expect(stackIdx, '## Stack must be present').toBeGreaterThan(-1);

    // Definition sections come before Stack.
    expect(problemIdx).toBeLessThan(stackIdx);
    expect(goalsIdx).toBeLessThan(stackIdx);
    expect(scopeInIdx).toBeLessThan(stackIdx);
    expect(scopeOutIdx).toBeLessThan(stackIdx);
  });

  it('definition_sections_appear_in_documented_order_Problem_Goals_ScopeIn_ScopeOut', async () => {
    const { writeProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-def-ac2-docorder');
    await writeProjectMd({
      repoRoot: repoDir,
      answers: baseAnswers({
        problem_statement: 'The problem.',
        goals: ['goal one'],
        scope_in: ['in scope'],
        scope_out: ['out of scope'],
      }),
      now: () => FIXED_NOW,
    });

    const text = readFileSync(join(repoDir, 'PROJECT.md'), 'utf8');

    const problemIdx = text.indexOf('## Problem');
    const goalsIdx = text.indexOf('## Goals');
    const scopeInIdx = text.indexOf('## Scope (in)');
    const scopeOutIdx = text.indexOf('## Scope (out)');

    // Problem → Goals → Scope (in) → Scope (out).
    expect(problemIdx).toBeLessThan(goalsIdx);
    expect(goalsIdx).toBeLessThan(scopeInIdx);
    expect(scopeInIdx).toBeLessThan(scopeOutIdx);
  });

  it('omits_Problem_heading_when_problem_statement_is_absent', async () => {
    const { writeProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-def-ac2-omit-prob');
    await writeProjectMd({
      repoRoot: repoDir,
      answers: baseAnswers(),  // no problem_statement
      now: () => FIXED_NOW,
    });

    const text = readFileSync(join(repoDir, 'PROJECT.md'), 'utf8');
    expect(text).not.toMatch(/^## Problem$/m);
  });

  it('omits_Goals_heading_when_goals_is_absent', async () => {
    const { writeProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-def-ac2-omit-goals');
    await writeProjectMd({
      repoRoot: repoDir,
      answers: baseAnswers(),  // no goals
      now: () => FIXED_NOW,
    });

    const text = readFileSync(join(repoDir, 'PROJECT.md'), 'utf8');
    expect(text).not.toMatch(/^## Goals$/m);
  });

  it('omits_Goals_heading_when_goals_is_empty_array', async () => {
    const { writeProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-def-ac2-empty-goals');
    await writeProjectMd({
      repoRoot: repoDir,
      answers: baseAnswers({ goals: [] }),
      now: () => FIXED_NOW,
    });

    const text = readFileSync(join(repoDir, 'PROJECT.md'), 'utf8');
    // Empty array must produce NO heading and NO stray bullets.
    expect(text).not.toMatch(/^## Goals$/m);
  });

  it('omits_Problem_heading_when_problem_statement_is_empty_string', async () => {
    const { writeProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-def-ac2-empty-prob');
    await writeProjectMd({
      repoRoot: repoDir,
      answers: baseAnswers({ problem_statement: '' }),
      now: () => FIXED_NOW,
    });

    const text = readFileSync(join(repoDir, 'PROJECT.md'), 'utf8');
    expect(text).not.toMatch(/^## Problem$/m);
  });

  it('omits_ScopeIn_heading_when_scope_in_is_empty_array', async () => {
    const { writeProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-def-ac2-empty-scopein');
    await writeProjectMd({
      repoRoot: repoDir,
      answers: baseAnswers({ scope_in: [] }),
      now: () => FIXED_NOW,
    });

    const text = readFileSync(join(repoDir, 'PROJECT.md'), 'utf8');
    expect(text).not.toMatch(/^## Scope \(in\)$/m);
  });

  it('omits_ScopeOut_heading_when_scope_out_is_empty_array', async () => {
    const { writeProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-def-ac2-empty-scopeout');
    await writeProjectMd({
      repoRoot: repoDir,
      answers: baseAnswers({ scope_out: [] }),
      now: () => FIXED_NOW,
    });

    const text = readFileSync(join(repoDir, 'PROJECT.md'), 'utf8');
    expect(text).not.toMatch(/^## Scope \(out\)$/m);
  });
});

// ---------------------------------------------------------------------------
// AC3 — round-trip losslessness, including items with commas/punctuation
// ---------------------------------------------------------------------------

describe('TASK-045 AC3 — readProjectMd round-trips new definition sections losslessly', () => {
  it('round_trips_problem_statement', async () => {
    const { writeProjectMd, readProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-def-ac3-prob');
    const problem = 'Teams lose context when switching between long-running projects.';
    await writeProjectMd({
      repoRoot: repoDir,
      answers: baseAnswers({ problem_statement: problem }),
      now: () => FIXED_NOW,
    });

    // The data must be in the body under ## Problem — NOT in ## Stack.
    const text = readFileSync(join(repoDir, 'PROJECT.md'), 'utf8');
    expect(text).toMatch(/^## Problem$/m);
    // Must NOT appear as a Stack bullet.
    const stackIdx = text.indexOf('## Stack');
    if (stackIdx > -1) {
      const stackSection = text.slice(stackIdx);
      expect(stackSection).not.toMatch(/problem_statement/);
    }

    const out = await readProjectMd({ repoRoot: repoDir });
    expect(out.answers.problem_statement).toBe(problem);
  });

  it('round_trips_goals_array', async () => {
    const { writeProjectMd, readProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-def-ac3-goals');
    const goals = ['reduce onboarding time', 'improve knowledge retention'];
    await writeProjectMd({
      repoRoot: repoDir,
      answers: baseAnswers({ goals }),
      now: () => FIXED_NOW,
    });

    // The data must be in the body under ## Goals — NOT in ## Stack.
    const text = readFileSync(join(repoDir, 'PROJECT.md'), 'utf8');
    expect(text).toMatch(/^## Goals$/m);
    // Each goal must be a separate bullet line in ## Goals, not an inline array in Stack.
    expect(text).toMatch(/^- reduce onboarding time$/m);
    expect(text).toMatch(/^- improve knowledge retention$/m);
    const stackIdx = text.indexOf('## Stack');
    if (stackIdx > -1) {
      const stackSection = text.slice(stackIdx);
      expect(stackSection).not.toMatch(/^- goals:/m);
    }

    const out = await readProjectMd({ repoRoot: repoDir });
    expect(Array.isArray(out.answers.goals)).toBe(true);
    expect(out.answers.goals).toEqual(goals);
  });

  it('round_trips_scope_in_array', async () => {
    const { writeProjectMd, readProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-def-ac3-scopein');
    const scope_in = ['project intake wizard', 'agent briefing generation'];
    await writeProjectMd({
      repoRoot: repoDir,
      answers: baseAnswers({ scope_in }),
      now: () => FIXED_NOW,
    });

    // The data must be in the body under ## Scope (in) — NOT in ## Stack.
    const text = readFileSync(join(repoDir, 'PROJECT.md'), 'utf8');
    expect(text).toMatch(/^## Scope \(in\)$/m);
    expect(text).toMatch(/^- project intake wizard$/m);
    expect(text).toMatch(/^- agent briefing generation$/m);
    const stackIdx = text.indexOf('## Stack');
    if (stackIdx > -1) {
      const stackSection = text.slice(stackIdx);
      expect(stackSection).not.toMatch(/^- scope_in:/m);
    }

    const out = await readProjectMd({ repoRoot: repoDir });
    expect(Array.isArray(out.answers.scope_in)).toBe(true);
    expect(out.answers.scope_in).toEqual(scope_in);
  });

  it('round_trips_scope_out_array', async () => {
    const { writeProjectMd, readProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-def-ac3-scopeout');
    const scope_out = ['deployment tooling', 'CI/CD pipeline management'];
    await writeProjectMd({
      repoRoot: repoDir,
      answers: baseAnswers({ scope_out }),
      now: () => FIXED_NOW,
    });

    // The data must be in the body under ## Scope (out) — NOT in ## Stack.
    const text = readFileSync(join(repoDir, 'PROJECT.md'), 'utf8');
    expect(text).toMatch(/^## Scope \(out\)$/m);
    expect(text).toMatch(/^- deployment tooling$/m);
    const stackIdx = text.indexOf('## Stack');
    if (stackIdx > -1) {
      const stackSection = text.slice(stackIdx);
      expect(stackSection).not.toMatch(/^- scope_out:/m);
    }

    const out = await readProjectMd({ repoRoot: repoDir });
    expect(Array.isArray(out.answers.scope_out)).toBe(true);
    expect(out.answers.scope_out).toEqual(scope_out);
  });

  it('round_trips_goal_item_containing_comma_and_punctuation', async () => {
    // Bullets are one `- item` per line (not inline arrays), so commas in
    // bullet text are naturally safe — they are part of the line content, not
    // a separator. Assert the specific example from the AC: "ship fast, then iterate".
    const { writeProjectMd, readProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-def-ac3-comma');
    const goals = ['ship fast, then iterate', 'measure: validate, adapt'];
    await writeProjectMd({
      repoRoot: repoDir,
      answers: baseAnswers({ goals }),
      now: () => FIXED_NOW,
    });

    // On-disk each goal must be its own `- item` line (not escaped inline array).
    const text = readFileSync(join(repoDir, 'PROJECT.md'), 'utf8');
    expect(text).toMatch(/^## Goals$/m);
    // The exact items must appear as plain bullet lines (commas unescaped).
    expect(text).toMatch(/^- ship fast, then iterate$/m);
    expect(text).toMatch(/^- measure: validate, adapt$/m);

    // Round-trip must be lossless.
    const out = await readProjectMd({ repoRoot: repoDir });
    expect(out.answers.goals).toEqual(goals);
  });

  it('round_trips_scope_in_item_containing_comma', async () => {
    const { writeProjectMd, readProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-def-ac3-scopein-comma');
    const scope_in = ['intake, discovery, and planning', 'schema validation'];
    await writeProjectMd({
      repoRoot: repoDir,
      answers: baseAnswers({ scope_in }),
      now: () => FIXED_NOW,
    });

    const text = readFileSync(join(repoDir, 'PROJECT.md'), 'utf8');
    expect(text).toMatch(/^## Scope \(in\)$/m);
    // Commas must appear unescaped in bullet lines.
    expect(text).toMatch(/^- intake, discovery, and planning$/m);

    const out = await readProjectMd({ repoRoot: repoDir });
    expect(out.answers.scope_in).toEqual(scope_in);
  });

  it('round_trips_all_four_new_fields_together', async () => {
    const { writeProjectMd, readProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-def-ac3-all');
    const answers = baseAnswers({
      problem_statement: 'Teams lose context: projects grow, memory shrinks.',
      goals: ['ship fast, then iterate', 'keep docs up-to-date'],
      scope_in: ['intake wizard', 'agent briefing'],
      scope_out: ['deployment tooling', 'billing, payments'],
    });
    await writeProjectMd({ repoRoot: repoDir, answers, now: () => FIXED_NOW });

    // Assert correct body-section rendering on disk.
    const text = readFileSync(join(repoDir, 'PROJECT.md'), 'utf8');
    expect(text).toMatch(/^## Problem$/m);
    expect(text).toMatch(/^## Goals$/m);
    expect(text).toMatch(/^## Scope \(in\)$/m);
    expect(text).toMatch(/^## Scope \(out\)$/m);
    // Bullets must appear unescaped (commas natural in bullet format).
    expect(text).toMatch(/^- ship fast, then iterate$/m);
    expect(text).toMatch(/^- billing, payments$/m);

    const out = await readProjectMd({ repoRoot: repoDir });
    expect(out.answers.problem_statement).toBe(answers.problem_statement);
    expect(out.answers.goals).toEqual(answers.goals);
    expect(out.answers.scope_in).toEqual(answers.scope_in);
    expect(out.answers.scope_out).toEqual(answers.scope_out);
  });
});

// ---------------------------------------------------------------------------
// AC4 — back-compat: PROJECT.md WITHOUT new sections reads back with new
// fields undefined; existing fields unchanged.
// ---------------------------------------------------------------------------

describe('TASK-045 AC4 — back-compat: old PROJECT.md reads without new fields', () => {
  it('reads_back_new_fields_as_undefined_when_absent', async () => {
    const { writeProjectMd, readProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-def-ac4-absent');
    // Write a PROJECT.md that has NONE of the new fields.
    await writeProjectMd({
      repoRoot: repoDir,
      answers: {
        project_name: 'legacy-project',
        project_type: 'library',
        project_description: 'An existing project without the new fields.',
        target_users: 'library consumers',
        success_criteria: 'API is stable',
      },
      now: () => FIXED_NOW,
    });

    const out = await readProjectMd({ repoRoot: repoDir });

    // New fields must be absent (undefined).
    expect(out.answers.problem_statement).toBeUndefined();
    expect(out.answers.goals).toBeUndefined();
    expect(out.answers.scope_in).toBeUndefined();
    expect(out.answers.scope_out).toBeUndefined();
  });

  it('existing_fields_unchanged_when_new_fields_absent', async () => {
    const { writeProjectMd, readProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-def-ac4-existing');
    const originalAnswers = {
      project_name: 'stable-project',
      project_type: 'web-saas',
      project_description: 'A stable project.',
      target_users: 'end users',
      success_criteria: 'ships on time',
      primary_use_cases: ['login', 'dashboard view'],
      frontend_framework: 'Vue',
      backend_framework: 'Django',
    };
    await writeProjectMd({
      repoRoot: repoDir,
      answers: originalAnswers,
      now: () => FIXED_NOW,
    });

    const out = await readProjectMd({ repoRoot: repoDir });

    // Core existing fields must be preserved.
    expect(out.answers.project_name).toBe('stable-project');
    expect(out.answers.project_type).toBe('web-saas');
    expect(out.answers.project_description).toBe('A stable project.');
    expect(out.answers.target_users).toBe('end users');
    expect(out.answers.success_criteria).toBe('ships on time');
    expect(out.answers.primary_use_cases).toEqual(['login', 'dashboard view']);
    expect(out.answers.frontend_framework).toBe('Vue');
    expect(out.answers.backend_framework).toBe('Django');

    // New fields still absent.
    expect(out.answers.problem_statement).toBeUndefined();
    expect(out.answers.goals).toBeUndefined();
    expect(out.answers.scope_in).toBeUndefined();
    expect(out.answers.scope_out).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// AC5 — generateProjectContext surfaces definition block in project-context.md;
// graceful degradation when fields are absent.
// ---------------------------------------------------------------------------

describe('TASK-045 AC5 — generateProjectContext surfaces definition in project-context.md', () => {
  it('project_context_md_includes_definition_section_when_fields_present', async () => {
    const { generateProjectContext } = await import(PROD.agentGenerator);

    const repoDir = makeTmpDir('af-def-ac5-full');
    const result = await generateProjectContext({
      repoRoot: repoDir,
      answers: {
        project_name: 'context-demo',
        project_type: 'cli-tool',
        problem_statement: 'Developers forget project context between sessions.',
        goals: ['surface project context to subagents', 'reduce context loss'],
        scope_in: ['project intake', 'briefing generation'],
        scope_out: ['deployment'],
      },
      now: () => FIXED_NOW,
    });

    const text = readFileSync(result.path, 'utf8');

    // The definition block must appear as a dedicated section with a heading —
    // NOT just dumped into ## Stack as extra bullets.
    // We require at least one heading for the definition content so subagents
    // can find it structurally (not just grep for prose).
    // The AC says "surfaces the definition (problem/goals/scope)" — at minimum
    // problem_statement and goals must appear under their own heading outside Stack.
    const stackIdx = text.indexOf('## Stack');

    // problem_statement content must NOT be relegated to ## Stack.
    if (stackIdx > -1) {
      const stackSection = text.slice(stackIdx);
      expect(
        stackSection,
        'problem_statement must not appear as a Stack bullet',
      ).not.toMatch(/problem_statement/);
    }

    // A definition heading must exist (the spec leaves naming flexible but
    // we need SOMETHING structural beyond ## Stack to satisfy AC5).
    // Assert that the content appears BEFORE ## Stack or under its own ## heading.
    const hasProblemHeading = /^## Problem$/m.test(text);
    const hasDefinitionHeading = /^## (Problem|Project definition|Definition|Overview)/m.test(text);
    expect(
      hasProblemHeading || hasDefinitionHeading,
      'project-context.md must surface problem/goals in a dedicated section heading (not just ## Stack)',
    ).toBe(true);

    // The text content must be present.
    expect(text).toContain('Developers forget project context between sessions.');
    expect(text).toContain('surface project context to subagents');
    expect(text).toContain('reduce context loss');
  });

  it('project_context_md_does_not_crash_when_definition_fields_absent', async () => {
    const { generateProjectContext } = await import(PROD.agentGenerator);

    const repoDir = makeTmpDir('af-def-ac5-absent');
    // No problem_statement, goals, scope_in, scope_out in answers.
    await expect(
      generateProjectContext({
        repoRoot: repoDir,
        answers: {
          project_name: 'no-def-demo',
          project_type: 'library',
        },
        now: () => FIXED_NOW,
      }),
    ).resolves.not.toThrow();
  });

  it('project_context_md_omits_definition_section_when_fields_absent', async () => {
    const { generateProjectContext } = await import(PROD.agentGenerator);

    const repoDir = makeTmpDir('af-def-ac5-omit');
    const result = await generateProjectContext({
      repoRoot: repoDir,
      answers: {
        project_name: 'no-def-demo',
        project_type: 'library',
      },
      now: () => FIXED_NOW,
    });

    const text = readFileSync(result.path, 'utf8');

    // No stray "## Problem" or "## Goals" headings when fields are absent.
    expect(text).not.toMatch(/^## Problem$/m);
    expect(text).not.toMatch(/^## Goals$/m);
    expect(text).not.toMatch(/^## Scope/m);
  });

  it('project_context_md_reads_definition_from_project_md_when_no_answers_injected', async () => {
    const { generateProjectContext } = await import(PROD.agentGenerator);
    const { writeProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-def-ac5-disk');
    await writeProjectMd({
      repoRoot: repoDir,
      answers: {
        project_name: 'disk-sourced',
        project_type: 'web-saas',
        project_description: 'sourced from disk',
        target_users: 'devs',
        success_criteria: 'works',
        problem_statement: 'Context is lost.',
        goals: ['retain context', 'fast onboarding'],
      },
      now: () => FIXED_NOW,
    });

    // Call WITHOUT injected answers — generator reads PROJECT.md from disk.
    const result = await generateProjectContext({
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    const text = readFileSync(result.path, 'utf8');

    // The problem statement read from disk must surface in project-context.md
    // under a dedicated definition heading (not just as a Stack bullet).
    const hasProblemHeading = /^## Problem$/m.test(text);
    const hasDefinitionHeading = /^## (Problem|Project definition|Definition|Overview)/m.test(text);
    expect(
      hasProblemHeading || hasDefinitionHeading,
      'project-context.md must surface the definition under a heading, not just ## Stack',
    ).toBe(true);

    expect(text).toContain('Context is lost.');
    expect(text).toContain('retain context');
  });
});
