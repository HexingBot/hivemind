// TASK-240 CU1 — per-project wargame_engine setting (init question, save, read).
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PROD } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { makeScriptedPrompter, webSaasAnswers } from '../helpers/scripted-prompter.js';

afterAll(cleanupAll);

const FM = '---\nname: demo\ntype: cli-tool\ncreated_at: 2026-01-01T00:00:00Z\nschema_version: 1\n---\n\n# demo\n\n## Description\nhi\n';
const mod = () => import('../../src/wargame-engine.js');

describe('TASK-240 CU1 — wargame_engine', () => {
  // Harm: a skipped or invalid answer silently persisting would make a choice the human never made.
  it('save_only_writes_valid_values_and_leaves_PROJECT_md_untouched_otherwise', async () => {
    const { saveWargameEngine } = await mod();
    const dir = makeTmpDir('wge-save');
    const p = join(dir, 'PROJECT.md');
    writeFileSync(p, FM);
    for (const v of ['', undefined, null, 'banana', 'wrecker, hivemind']) {
      const r = await saveWargameEngine({ repoRoot: dir, value: v });
      expect(r.saved).toBe(false);
      expect(readFileSync(p, 'utf8')).toBe(FM);
    }
    expect(await saveWargameEngine({ repoRoot: dir, value: 'Wrecker' })).toEqual({ saved: true, engine: 'wrecker' });
    // Surgical: exactly one line added to the frontmatter, nothing else changed.
    expect(readFileSync(p, 'utf8')).toBe(FM.replace('schema_version: 1\n', 'schema_version: 1\nwargame_engine: wrecker\n'));
    await saveWargameEngine({ repoRoot: dir, value: 'hivemind' });
    expect(readFileSync(p, 'utf8')).toBe(FM.replace('schema_version: 1\n', 'schema_version: 1\nwargame_engine: hivemind\n'));
  });

  // Harm: collapsing "unset" into a default engine would make the orchestrator skip the question.
  it('read_distinguishes_unset_invalid_set_and_no_project', async () => {
    const { readWargameEngine } = await mod();
    const dir = makeTmpDir('wge-read');
    expect(await readWargameEngine({ repoRoot: dir })).toEqual({ status: 'no-project-md' });
    const p = join(dir, 'PROJECT.md');
    writeFileSync(p, FM);
    expect(await readWargameEngine({ repoRoot: dir })).toEqual({ status: 'unset' });
    writeFileSync(p, FM.replace('schema_version: 1\n', 'schema_version: 1\nwargame_engine: bogus\n'));
    expect(await readWargameEngine({ repoRoot: dir })).toEqual({ status: 'invalid', raw: 'bogus' });
    writeFileSync(p, FM.replace('schema_version: 1\n', 'schema_version: 1\nwargame_engine: hivemind\n'));
    expect(await readWargameEngine({ repoRoot: dir })).toEqual({ status: 'set', engine: 'hivemind' });
  });

  // Harm: init saving a skipped/invalid answer (or dropping a valid one) leaves the project with a wrong or silent engine.
  it('init_saves_a_valid_answer_and_saves_nothing_when_skipped_or_invalid', async () => {
    const { runInit } = await import(PROD.init);
    const { readWargameEngine } = await mod();
    const run = async (answer) => {
      const dir = makeTmpDir('wge-init');
      await runInit({
        argv: [], repoRoot: dir, now: () => '2026-05-26T12:00:00Z', hostname: 'h',
        prompter: makeScriptedPrompter(webSaasAnswers({ wargame_engine: answer })),
      });
      return readWargameEngine({ repoRoot: dir });
    };
    expect(await run('wrecker')).toEqual({ status: 'set', engine: 'wrecker' });
    expect(await run('hivemind')).toEqual({ status: 'set', engine: 'hivemind' });
    expect(await run('')).toEqual({ status: 'unset' });
    expect(await run('nope')).toEqual({ status: 'unset' });
  });

  // Harm: a natural hand edit (quoted/capitalised) read as invalid makes the orchestrator re-ask a setting the human already chose;
  // a bad value read as set would silently pick an engine. Also: --set with no value must fail, not silently no-op.
  it('CU3_hand_edit_is_normalized_on_read_and_set_without_value_is_a_parse_error', async () => {
    const { readWargameEngine, saveWargameEngine } = await mod();
    const { runInit } = await import(PROD.init);
    const dir = makeTmpDir('wge-cu3');
    const p = join(dir, 'PROJECT.md');
    const NL = String.fromCharCode(10);
    const withLine = (v) => FM.replace(`schema_version: 1${NL}`, `schema_version: 1${NL}wargame_engine: ${v}${NL}`);
    for (const [v, want] of [['"wrecker"', 'wrecker'], ["'Hivemind'", 'hivemind'], ['Wrecker', 'wrecker']]) {
      writeFileSync(p, withLine(v));
      expect(await readWargameEngine({ repoRoot: dir })).toEqual({ status: 'set', engine: want });
    }
    for (const v of ['banana', `"wrecker'`, '""']) {
      writeFileSync(p, withLine(v));
      expect((await readWargameEngine({ repoRoot: dir })).status).toBe('invalid');
    }
    writeFileSync(p, withLine('"wrecker"'));
    await saveWargameEngine({ repoRoot: dir, value: 'hivemind' });
    expect(readFileSync(p, 'utf8')).toBe(withLine('hivemind'));
    for (const argv of [['--set-wargame-engine'], ['--set-wargame-engine', '--yes']]) {
      await expect(runInit({ argv, repoRoot: dir, prompter: () => { throw new Error('asked'); } }))
        .rejects.toThrow(/--set-wargame-engine requires a value/);
    }
    expect(readFileSync(p, 'utf8')).toBe(withLine('hivemind'));
  });
});
