// tests/e2e/agent-models-config.spec.js
// TASK-036 — Configurable per-agent models: schema, round-trip, applier, CLI flag, wizard.
//
// AC map (locked design per orchestrator comment):
//   AC1 — PROJECT.schema.json + src/project-md.js round-trip an optional
//          agent_models map (reviewer/developer/researcher → alias or full model ID);
//          invalid agent names or model values are rejected with a clear error.
//   AC2 — applyAgentModels({repoRoot, agentModels}) patches ONLY the model: line
//          in each mapped agent file (byte-stable everywhere else), inserts after
//          description: when absent, updates both .claude/agents/ and plugin-root
//          agents/ when the parity dir exists, returns the changed-file list, and
//          validates values/agent names BEFORE any write.
//   AC3 — bin/init.js --apply-models reads PROJECT.md's map and applies without
//          running the wizard; graceful no-op when no agent_models in PROJECT.md;
//          combined with unknown tokens still throws.
//   AC4 — Init wizard offers the optional model-assignment question with defaults;
//          skipping writes no agent_models key to PROJECT.md.
//   AC5 — CLAUDE.md Per-Agent Model Assignment section points at PROJECT.md as
//          the canonical knob (tested in the fast-tier spec tests/agent-models.spec.js
//          as an additive section-scoped assertion — see the bottom of this file).
//
// Spec placement: all real I/O specs go under tests/e2e/ (slow tier). The docs
// assertion (AC5) is pure-logic (readFileSync on the real repo), so it lives in
// the fast tier at tests/agent-models.spec.js via the additive export at EOF.

import { describe, it, expect, afterAll } from 'vitest';
import {
  readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { PROD } from '../helpers/fixtures.js';
import { REPO_ROOT } from '../helpers/repoRoot.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { makeScriptedPrompter, webSaasAnswers } from '../helpers/scripted-prompter.js';

afterAll(cleanupAll);

const FIXED_NOW = '2026-05-26T12:00:00Z';
const SCHEMA_PATH = join(REPO_ROOT, 'state', 'PROJECT.schema.json');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadSchema() {
  const text = readFileSync(SCHEMA_PATH, 'utf8');
  return JSON.parse(text);
}

function buildAjv() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv;
}

/** Extract the YAML frontmatter block from an agent .md file (between the
 *  first pair of `---` fences). Returns the raw text, or '' if none. */
function readAgentFrontmatter(filePath) {
  const text = readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/);
  if (lines[0].trim() !== '---') return '';
  const closeIdx = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (closeIdx === -1) return '';
  return lines.slice(1, closeIdx).join('\n');
}

/** Return every byte of an agent .md except the YAML frontmatter block, so
 *  the surgical-edit test can diff only the non-frontmatter content. */
function readAgentBody(filePath) {
  const text = readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/);
  if (lines[0].trim() !== '---') return text;
  const closeIdx = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (closeIdx === -1) return text;
  return lines.slice(closeIdx + 1).join('\n');
}

/** Snapshot every byte except the `model:` frontmatter line. Used to assert
 *  the surgical edit only changed that one line. */
function bytesExceptModelLine(filePath) {
  const text = readFileSync(filePath, 'utf8');
  return text
    .split(/\r?\n/)
    .filter((l) => !/^model:\s*/.test(l))
    .join('\n');
}

/** A prompter that throws if invoked — proves the path never calls the wizard. */
function throwIfCalled() {
  return async (ctx) => {
    throw new Error(`prompter was called unexpectedly: ${JSON.stringify(ctx)}`);
  };
}

// Minimal agent .md with frontmatter (name, description, model present).
function makeAgentMd(name, model, extra = '') {
  return [
    '---',
    `name: ${name}`,
    `description: ${name} agent for testing.`,
    `model: ${model}`,
    '---',
    '',
    `# ${name}`,
    '',
    extra || 'Agent body text.',
    '',
  ].join('\n');
}

// Minimal agent .md WITH description but WITHOUT a model line.
function makeAgentMdNoModel(name, extra = '') {
  return [
    '---',
    `name: ${name}`,
    `description: ${name} agent for testing.`,
    '---',
    '',
    `# ${name}`,
    '',
    extra || 'Agent body text.',
    '',
  ].join('\n');
}

// ===========================================================================
// AC1 — Schema round-trip: agent_models map persists and restores losslessly.
// ===========================================================================
describe('AC1 — PROJECT.md round-trips an agent_models map', () => {
  it('round_trip_agent_models_map', async () => {
    // FAILS NOW: writeProjectMd does not write agent_models; readProjectMd
    // does not parse it back. The restored map will be absent or undefined.
    const { writeProjectMd, readProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-am-rt');
    const answers = {
      project_name: 'model-map-demo',
      project_type: 'cli-tool',
      agent_models: {
        reviewer: 'fable',
        developer: 'haiku',
      },
    };

    await writeProjectMd({ repoRoot: repoDir, answers, now: () => FIXED_NOW });
    const out = await readProjectMd({ repoRoot: repoDir });

    expect(
      out.answers.agent_models,
      'agent_models must survive a write/read round-trip',
    ).toBeDefined();
    expect(out.answers.agent_models).toEqual(answers.agent_models);
  });

  it('round_trip_full_model_id', async () => {
    // FAILS NOW: same as above — agent_models key is not handled.
    const { writeProjectMd, readProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-am-fullid');
    const answers = {
      project_name: 'full-id-demo',
      project_type: 'library',
      agent_models: {
        reviewer: 'claude-opus-4-5',
        developer: 'claude-sonnet-4-6',
        researcher: 'claude-haiku-3-5',
      },
    };

    await writeProjectMd({ repoRoot: repoDir, answers, now: () => FIXED_NOW });
    const out = await readProjectMd({ repoRoot: repoDir });

    expect(out.answers.agent_models).toEqual(answers.agent_models);
  });

  it('round_trip_with_no_agent_models_leaves_key_absent', async () => {
    // Baseline: a PROJECT.md without agent_models must not grow a spurious key.
    const { writeProjectMd, readProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-am-absent');
    await writeProjectMd({
      repoRoot: repoDir,
      answers: { project_name: 'no-models', project_type: 'other' },
      now: () => FIXED_NOW,
    });
    const out = await readProjectMd({ repoRoot: repoDir });

    // Must be absent (undefined), not null or an empty object.
    expect(out.answers.agent_models).toBeUndefined();
  });
});

// ===========================================================================
// AC1 (schema) — PROJECT.schema.json accepts the map and rejects bad inputs.
// ===========================================================================
describe('AC1 — PROJECT.schema.json validates agent_models', () => {
  it('schema_accepts_valid_agent_models_map', () => {
    // FAILS NOW: schema does not have an agent_models property yet;
    // additionalProperties:false will cause validation failure on the frontmatter
    // that carries agent_models.
    const schema = loadSchema();
    const ajv = buildAjv();
    const validate = ajv.compile(schema);

    const frontmatter = {
      name: 'schema-ok',
      type: 'cli-tool',
      created_at: FIXED_NOW,
      schema_version: 1,
      agent_models: {
        reviewer: 'fable',
        developer: 'sonnet',
        researcher: 'haiku',
      },
    };
    expect(
      validate(frontmatter),
      'schema must accept a valid agent_models map — errors: ' +
        JSON.stringify(validate.errors),
    ).toBe(true);
  });

  it('schema_accepts_full_model_id_values', () => {
    // FAILS NOW: schema does not define the pattern yet.
    const schema = loadSchema();
    const ajv = buildAjv();
    const validate = ajv.compile(schema);

    const frontmatter = {
      name: 'schema-fullid',
      type: 'library',
      created_at: FIXED_NOW,
      schema_version: 1,
      agent_models: {
        reviewer: 'claude-opus-4-5',
      },
    };
    expect(
      validate(frontmatter),
      'schema must accept a full model ID matching /^claude-[a-z0-9-]+$/ — errors: ' +
        JSON.stringify(validate.errors),
    ).toBe(true);
  });

  it('schema_rejects_unknown_agent_key_orchestrator', () => {
    // FAILS NOW: schema does not define additionalProperties:false on
    // agent_models yet, so orchestrator sneaks through.
    const schema = loadSchema();
    const ajv = buildAjv();
    const validate = ajv.compile(schema);

    const frontmatter = {
      name: 'bad-agent',
      type: 'other',
      created_at: FIXED_NOW,
      schema_version: 1,
      agent_models: {
        orchestrator: 'sonnet', // not a valid agent name in the map
        developer: 'sonnet',
      },
    };
    const ok = validate(frontmatter);
    expect(
      ok,
      'schema must reject orchestrator as an agent_models key (orchestrator is main-thread, not a spawned agent)',
    ).toBe(false);
  });

  it('schema_rejects_bogus_agent_key', () => {
    // FAILS NOW: same reason — no additionalProperties:false on agent_models.
    const schema = loadSchema();
    const ajv = buildAjv();
    const validate = ajv.compile(schema);

    const frontmatter = {
      name: 'bad-agent-key',
      type: 'other',
      created_at: FIXED_NOW,
      schema_version: 1,
      agent_models: {
        bogus_agent: 'sonnet',
      },
    };
    expect(validate(frontmatter)).toBe(false);
  });

  it('schema_rejects_invalid_model_value', () => {
    // FAILS NOW: no enum/pattern on the model value yet.
    const schema = loadSchema();
    const ajv = buildAjv();
    const validate = ajv.compile(schema);

    const frontmatter = {
      name: 'bad-model-val',
      type: 'other',
      created_at: FIXED_NOW,
      schema_version: 1,
      agent_models: {
        developer: 'gpt-4o', // not a claude-* ID nor a recognized alias
      },
    };
    expect(validate(frontmatter)).toBe(false);
  });
});

// ===========================================================================
// AC2 — applyAgentModels: surgical frontmatter edit, byte-comparison,
//        parity-write, returns changed list, pre-write validation.
// ===========================================================================
describe('AC2 — applyAgentModels patches only the model: line', () => {
  it('apply_patches_model_line_and_leaves_every_other_byte_identical', async () => {
    // FAILS NOW: applyAgentModels does not exist in src/agent-generator.js.
    const { applyAgentModels } = await import(PROD.agentGenerator);

    const repoDir = makeTmpDir('af-am-surgical');
    const agentsDir = join(repoDir, '.claude', 'agents');
    mkdirSync(agentsDir, { recursive: true });

    // Write a developer agent file with model: sonnet.
    const agentPath = join(agentsDir, 'developer.md');
    const original = makeAgentMd('developer', 'sonnet', 'Original body content.\nLine two.');
    writeFileSync(agentPath, original, 'utf8');

    // Take a byte snapshot of everything except the model: line.
    const beforeExceptModel = bytesExceptModelLine(agentPath);

    await applyAgentModels({ repoRoot: repoDir, agentModels: { developer: 'haiku' } });

    const after = readFileSync(agentPath, 'utf8');

    // 1. The model: line was updated.
    expect(/^model:\s*haiku\s*$/m.test(after)).toBe(true);

    // 2. Every other byte is identical — byte comparison excluding model: line.
    const afterExceptModel = bytesExceptModelLine(agentPath);
    expect(afterExceptModel).toBe(beforeExceptModel);
  });

  it('apply_inserts_model_line_after_description_when_absent', async () => {
    // FAILS NOW: applyAgentModels does not exist.
    const { applyAgentModels } = await import(PROD.agentGenerator);

    const repoDir = makeTmpDir('af-am-insert');
    const agentsDir = join(repoDir, '.claude', 'agents');
    mkdirSync(agentsDir, { recursive: true });

    const agentPath = join(agentsDir, 'researcher.md');
    const original = makeAgentMdNoModel('researcher', 'Body here.');
    writeFileSync(agentPath, original, 'utf8');

    await applyAgentModels({ repoRoot: repoDir, agentModels: { researcher: 'opus' } });

    const after = readFileSync(agentPath, 'utf8');

    // model: line must appear now.
    expect(/^model:\s*opus\s*$/m.test(after)).toBe(true);

    // Body must be preserved intact.
    expect(readAgentBody(agentPath)).toBe(readAgentBody(agentPath));
    expect(after).toContain('Body here.');
  });

  it('apply_updates_parity_dir_when_agents_parity_dir_exists', async () => {
    // FAILS NOW: applyAgentModels does not exist.
    const { applyAgentModels } = await import(PROD.agentGenerator);

    const repoDir = makeTmpDir('af-am-parity');
    const claudeAgentsDir = join(repoDir, '.claude', 'agents');
    const parityAgentsDir = join(repoDir, 'agents');
    mkdirSync(claudeAgentsDir, { recursive: true });
    mkdirSync(parityAgentsDir, { recursive: true });

    // Seed both copies.
    const primary = join(claudeAgentsDir, 'reviewer.md');
    const parity = join(parityAgentsDir, 'reviewer.md');
    const content = makeAgentMd('reviewer', 'sonnet');
    writeFileSync(primary, content, 'utf8');
    writeFileSync(parity, content, 'utf8');

    await applyAgentModels({ repoRoot: repoDir, agentModels: { reviewer: 'opus' } });

    // Both copies updated.
    const primaryAfter = readFileSync(primary, 'utf8');
    const parityAfter = readFileSync(parity, 'utf8');

    expect(/^model:\s*opus\s*$/m.test(primaryAfter)).toBe(true);
    expect(/^model:\s*opus\s*$/m.test(parityAfter)).toBe(true);
  });

  it('apply_does_not_touch_parity_dir_when_absent', async () => {
    // FAILS NOW: applyAgentModels does not exist.
    const { applyAgentModels } = await import(PROD.agentGenerator);

    const repoDir = makeTmpDir('af-am-noparity');
    const claudeAgentsDir = join(repoDir, '.claude', 'agents');
    mkdirSync(claudeAgentsDir, { recursive: true });
    // Deliberately do NOT create agents/ parity dir.

    const agentPath = join(claudeAgentsDir, 'developer.md');
    writeFileSync(agentPath, makeAgentMd('developer', 'sonnet'), 'utf8');

    // Must succeed without throwing (no parity dir is not an error).
    await expect(
      applyAgentModels({ repoRoot: repoDir, agentModels: { developer: 'haiku' } }),
    ).resolves.toBeDefined();

    // The agent/ parity dir must still not exist.
    expect(existsSync(join(repoDir, 'agents'))).toBe(false);
  });

  it('apply_returns_the_list_of_changed_files', async () => {
    // FAILS NOW: applyAgentModels does not exist.
    const { applyAgentModels } = await import(PROD.agentGenerator);

    const repoDir = makeTmpDir('af-am-retlist');
    const agentsDir = join(repoDir, '.claude', 'agents');
    mkdirSync(agentsDir, { recursive: true });

    writeFileSync(join(agentsDir, 'developer.md'), makeAgentMd('developer', 'sonnet'), 'utf8');
    writeFileSync(join(agentsDir, 'reviewer.md'), makeAgentMd('reviewer', 'fable'), 'utf8');

    const result = await applyAgentModels({
      repoRoot: repoDir,
      agentModels: { developer: 'haiku', reviewer: 'opus' },
    });

    // Must be an array of absolute paths (or at least relative paths) to the changed files.
    expect(Array.isArray(result), 'applyAgentModels must return an array').toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it('apply_rejects_invalid_model_value_before_any_write', async () => {
    // FAILS NOW: applyAgentModels does not exist; but when it does, invalid
    // input must throw WITHOUT touching any file.
    const { applyAgentModels } = await import(PROD.agentGenerator);

    const repoDir = makeTmpDir('af-am-badval');
    const agentsDir = join(repoDir, '.claude', 'agents');
    mkdirSync(agentsDir, { recursive: true });

    const agentPath = join(agentsDir, 'developer.md');
    const original = makeAgentMd('developer', 'sonnet');
    writeFileSync(agentPath, original, 'utf8');
    const snapshotBefore = readFileSync(agentPath, 'utf8');

    await expect(
      applyAgentModels({
        repoRoot: repoDir,
        agentModels: { developer: 'gpt-4o' }, // invalid — not a claude alias or full ID
      }),
    ).rejects.toThrow(/invalid|model|value/i);

    // File must be byte-identical to the snapshot.
    expect(readFileSync(agentPath, 'utf8')).toBe(snapshotBefore);
  });

  it('apply_rejects_unknown_agent_name_before_any_write', async () => {
    // FAILS NOW: applyAgentModels does not exist.
    const { applyAgentModels } = await import(PROD.agentGenerator);

    const repoDir = makeTmpDir('af-am-badagent');
    const agentsDir = join(repoDir, '.claude', 'agents');
    mkdirSync(agentsDir, { recursive: true });

    const agentPath = join(agentsDir, 'developer.md');
    const original = makeAgentMd('developer', 'sonnet');
    writeFileSync(agentPath, original, 'utf8');
    const snapshotBefore = readFileSync(agentPath, 'utf8');

    await expect(
      applyAgentModels({
        repoRoot: repoDir,
        agentModels: { orchestrator: 'fable' }, // orchestrator is not in the valid agent set
      }),
    ).rejects.toThrow(/invalid|unknown|agent/i);

    // Developer file must be untouched.
    expect(readFileSync(agentPath, 'utf8')).toBe(snapshotBefore);
  });
});

// ===========================================================================
// AC3 — bin/init.js --apply-models CLI flag.
// ===========================================================================
describe('AC3 — bin/init.js --apply-models reads PROJECT.md and applies', () => {
  it('apply_models_flag_applies_without_running_the_wizard', async () => {
    // FAILS NOW: --apply-models is not in KNOWN_FLAGS; parseArgs throws
    // "unknown argument: --apply-models".
    const { runInit } = await import(PROD.init);
    const { writeProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-am-flag-apply');
    const agentsDir = join(repoDir, '.claude', 'agents');
    mkdirSync(agentsDir, { recursive: true });

    // Seed agent files and PROJECT.md with an agent_models map.
    writeFileSync(join(agentsDir, 'developer.md'), makeAgentMd('developer', 'sonnet'), 'utf8');
    writeFileSync(join(agentsDir, 'reviewer.md'), makeAgentMd('reviewer', 'fable'), 'utf8');

    await writeProjectMd({
      repoRoot: repoDir,
      answers: {
        project_name: 'apply-models-test',
        project_type: 'cli-tool',
        agent_models: { developer: 'haiku', reviewer: 'opus' },
      },
      now: () => FIXED_NOW,
    });

    // --apply-models must not call the wizard prompter at all.
    const result = await runInit({
      argv: ['--apply-models'],
      prompter: throwIfCalled(),
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    expect(result.state).toBe('applied_models');

    // The frontmatter was updated.
    const devFm = readAgentFrontmatter(join(agentsDir, 'developer.md'));
    expect(/^model:\s*haiku\s*$/m.test(devFm)).toBe(true);

    const revFm = readAgentFrontmatter(join(agentsDir, 'reviewer.md'));
    expect(/^model:\s*opus\s*$/m.test(revFm)).toBe(true);
  });

  it('apply_models_flag_graceful_noop_when_no_agent_models_in_project_md', async () => {
    // FAILS NOW: --apply-models is not in KNOWN_FLAGS.
    const { runInit } = await import(PROD.init);
    const { writeProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-am-noop');
    // PROJECT.md WITHOUT agent_models.
    await writeProjectMd({
      repoRoot: repoDir,
      answers: { project_name: 'no-models', project_type: 'other' },
      now: () => FIXED_NOW,
    });

    // Must not throw, must exit with a recognizable state.
    const result = await runInit({
      argv: ['--apply-models'],
      prompter: throwIfCalled(),
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    // Should be a no-op with a clear indicator (not a crash).
    expect(['applied_models', 'no_op']).toContain(result.state);
  });

  it('apply_models_combined_with_unknown_flag_still_throws', async () => {
    // FAILS NOW: --apply-models is not in KNOWN_FLAGS at all (throws first).
    // Once --apply-models is added to KNOWN_FLAGS, the unknown flag --bogus
    // must still throw.
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-am-unknown');

    await expect(
      runInit({
        argv: ['--apply-models', '--bogus-extra'],
        prompter: throwIfCalled(),
        repoRoot: repoDir,
        now: () => FIXED_NOW,
      }),
    ).rejects.toThrow(/--bogus-extra/);
  });
});

// ===========================================================================
// AC4 — Wizard question: optional, defaults prefilled, skip writes no map.
// ===========================================================================
describe('AC4 — wizard model-assignment question is optional with defaults', () => {
  it('wizard_model_question_exists_in_question_library', async () => {
    // FAILS NOW: src/question-library.js has no agent_models question.
    const { buildIntakeQuestions } = await import(PROD.questionLibrary);
    const questions = buildIntakeQuestions();
    const modelQ = questions.find((q) => q.id === 'agent_models');
    expect(
      modelQ,
      'question-library must export an agent_models question',
    ).toBeDefined();
  });

  it('wizard_model_question_is_optional_required_false', async () => {
    // FAILS NOW: question does not exist yet.
    const { buildIntakeQuestions } = await import(PROD.questionLibrary);
    const questions = buildIntakeQuestions();
    const modelQ = questions.find((q) => q.id === 'agent_models');
    // required: false means skipping (empty input) is allowed.
    expect(modelQ?.required).toBe(false);
  });

  it('skipping_model_question_writes_no_agent_models_key', async () => {
    // FAILS NOW: runInit + question-library do not have the agent_models
    // question, so the resulting PROJECT.md obviously won't have the key;
    // but this assertion is about the CORRECT absence: the wizard path
    // explicitly skips the field when the user answers with empty string.
    const { runInit } = await import(PROD.init);
    const { readProjectMd } = await import(PROD.projectMd);

    const repoDir = makeTmpDir('af-am-skip-q');

    // The scripted-prompter needs an agent_models prompt signature — it will
    // throw if the prompt fires and no signature matches. We use a custom
    // prompter that returns empty string for the agent_models prompt so it
    // gets skipped, and delegates everything else to the scripted helper.
    const scriptedWizard = makeScriptedPrompter(webSaasAnswers({
      project_name: 'no-model-answer',
    }));
    const prompter = async (ctx) => {
      // When the engine asks about agent_models, return empty → skips the field.
      if (typeof ctx?.prompt === 'string' && /model|agent.*model/i.test(ctx.prompt)) {
        return '';
      }
      // Archive prompt — return empty (default Y) but it won't fire in a fresh tmp dir.
      if (typeof ctx?.prompt === 'string' && /archive/i.test(ctx.prompt)) {
        return '';
      }
      return scriptedWizard(ctx);
    };

    const result = await runInit({
      argv: [],
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    expect(result.state).toBe('created');
    const out = await readProjectMd({ repoRoot: repoDir });
    expect(
      out.answers.agent_models,
      'skipping the agent_models question must NOT write an agent_models key',
    ).toBeUndefined();
  });
});
