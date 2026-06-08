// tests/task-018-corruption-policy.spec.js
// TASK-018 — align the corruption-handling policy between
// bin/init.js#countFrameworkHistory (the archive-prompt peek) and
// src/backlog-seeder.js#readAllTasksSync. Before this task lands, the peek
// silently swallows JSON.parse failures and treats a corrupt TASK-NNN.json as
// framework history — which inflates the archive prompt count, lets the user
// answer Y, runs the archive, and only then has the seeder blow up on the
// same corrupt bytes. Half-archived repo + raised exception = bad.
//
// The locked design choice is option (a) — countFrameworkHistory THROWS on
// parse error, surfacing the corruption BEFORE the archive prompt fires.
//
// ACs covered here:
//   AC1 — countFrameworkHistory (called via runInit) throws on a corrupt
//         TASK-NNN.json; the error names the offending file or mentions JSON.
//   AC2 — the throw surfaces BEFORE the archive prompt fires (prompter must
//         not be invoked for the archive question).
//   AC3 — src/backlog-seeder.js#readAllTasksSync docstring no longer claims
//         "Duplicated intentionally" — post-AC7, the regex is DRY-imported.
//   AC4 — the `if (!templates) continue;` inline comment references
//         TASK-017 AC2's design lock so the silent-ignore is unambiguous.

import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROD } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { makeScriptedPrompter, webSaasAnswers } from '../helpers/scripted-prompter.js';

afterAll(cleanupAll);

const FIXED_NOW = '2026-05-28T12:00:00Z';
const FIXED_HOST = 'test-host';

const __thisDir = dirname(fileURLToPath(import.meta.url));
const __seederSourcePath = join(__thisDir, '..', '..', 'src', 'backlog-seeder.js');

/**
 * Seed one framework-history-style ticket (no `seed` label) on disk so the
 * archive-prompt peek has at least one valid file to count alongside the
 * corrupt one. Mirrors the fixture shape used in tests/init.spec.js's
 * TASK-015 AC7d/e/f scenarios.
 */
function seedFrameworkHistoryTicket(tasksDir, key) {
  writeFileSync(
    join(tasksDir, `${key}.json`),
    JSON.stringify({
      key,
      title: `Synthetic ${key}`,
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

// ===========================================================================
// AC1 — countFrameworkHistory throws on corrupt JSON. Today it catches the
// JSON.parse failure inside its `try { ... } catch { /* swallow */ }` and
// treats the corrupt file as framework history; the runInit invocation
// continues into the archive prompt with an inflated count. After the fix the
// throw must propagate out of runInit so the user can fix the bytes before
// any destructive operation runs.
// ===========================================================================
describe('AC1 — countFrameworkHistory throws on corrupt task JSON', () => {
  it('corrupt_task_file_causes_runInit_to_reject_with_json_or_filename', async () => {
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-init-corrupt-throw');
    const tasksDir = join(repoDir, 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    // One valid framework-history ticket so the peek has something to compare
    // against; one corrupt sibling with a TASK-NNN.json filename so the read
    // loop is forced to JSON.parse it.
    seedFrameworkHistoryTicket(tasksDir, 'TASK-001');
    const corruptPath = join(tasksDir, 'TASK-999.json');
    writeFileSync(corruptPath, '{invalid json', 'utf8');

    // Use a full scripted prompter; the wizard would otherwise run after the
    // archive step. We only care that runInit rejects with the parse error.
    const prompter = makeScriptedPrompter(webSaasAnswers());

    let caught = null;
    try {
      await runInit({
        argv: [],
        prompter,
        repoRoot: repoDir,
        now: () => FIXED_NOW,
        hostname: FIXED_HOST,
      });
    } catch (err) {
      caught = err;
    }

    expect(
      caught,
      'runInit must reject when countFrameworkHistory hits a corrupt task file (no silent swallow)',
    ).not.toBeNull();
    expect(caught).toBeInstanceOf(Error);

    // The error message must point the user at the corruption — either by
    // naming the offending file (TASK-999) or by mentioning JSON parse.
    const msg = String(caught.message || '');
    const mentionsJson = /json/i.test(msg);
    const mentionsFile = msg.includes('TASK-999');
    expect(
      mentionsJson || mentionsFile,
      `error must name JSON or the corrupt filename — got ${JSON.stringify(msg)}`,
    ).toBe(true);
  });
});

// ===========================================================================
// AC2 — the throw surfaces BEFORE the archive prompt fires. Today's swallow
// would let the prompt run with an inflated count; after the fix the parse
// failure must propagate out of countFrameworkHistory before
// maybeArchiveFrameworkHistory calls the prompter.
//
// Test mechanic: wrap the wizard prompter with a router that throws ONLY when
// the archive prompt fires (matched by the literal "Archive" wording from
// bin/init.js#maybeArchiveFrameworkHistory). The runInit rejection must
// mention JSON / the corrupt filename — NOT the router's archive-prompt
// guard. If the wrong branch surfaces (router fires first), the test fails
// loudly with a distinct message so the failure mode is unambiguous.
// ===========================================================================
describe('AC2 — corruption throws before archive prompt fires', () => {
  it('archive_prompter_is_never_called_when_corrupt_file_exists', async () => {
    const { runInit } = await import(PROD.init);

    const repoDir = makeTmpDir('af-init-corrupt-before-prompt');
    const tasksDir = join(repoDir, 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    // Two valid framework-history tickets + one corrupt sibling. The valid
    // pair is the load-bearing detail — without them, today's count peek
    // might short-circuit on `taskFiles.length === 0` and skip the parse
    // loop entirely. We want the read loop to genuinely reach the corrupt
    // bytes so the swallow vs throw difference shows up.
    seedFrameworkHistoryTicket(tasksDir, 'TASK-001');
    seedFrameworkHistoryTicket(tasksDir, 'TASK-002');
    writeFileSync(join(tasksDir, 'TASK-999.json'), '{nope', 'utf8');

    const wizard = makeScriptedPrompter(webSaasAnswers());
    // Router: throw a uniquely-worded error if the archive prompt ever fires.
    // Wizard prompts (project_name etc.) pass through to the scripted handler.
    const ARCHIVE_GUARD = 'TASK-018-AC2-archive-prompt-fired-too-early';
    const prompter = async (ctx) => {
      if (typeof ctx?.prompt === 'string' && /archive/i.test(ctx.prompt)) {
        throw new Error(ARCHIVE_GUARD);
      }
      return wizard(ctx);
    };

    let caught = null;
    try {
      await runInit({
        argv: [],
        prompter,
        repoRoot: repoDir,
        now: () => FIXED_NOW,
        hostname: FIXED_HOST,
      });
    } catch (err) {
      caught = err;
    }

    expect(caught, 'runInit must reject in the corrupt-file scenario').not.toBeNull();
    expect(caught).toBeInstanceOf(Error);

    const msg = String(caught.message || '');

    // Failure mode disambiguation: if the archive prompt fired before the
    // throw, the router's guard string would show up in the rejection. That
    // means the throw landed in the WRONG order (AC2 violated) — flag it.
    expect(
      msg.includes(ARCHIVE_GUARD),
      'archive prompt fired before the corruption throw — AC2 violated '
        + '(throw must surface inside countFrameworkHistory, before any prompter call)',
    ).toBe(false);

    // Positive assertion: the rejection is the JSON/filename surface from AC1.
    const mentionsJson = /json/i.test(msg);
    const mentionsFile = msg.includes('TASK-999');
    expect(
      mentionsJson || mentionsFile,
      `expected JSON-parse / filename rejection, got ${JSON.stringify(msg)}`,
    ).toBe(true);

    // Belt-and-suspenders: the wizard prompter must also not have been
    // called. countFrameworkHistory runs before the wizard, so any wizard
    // call would mean the throw didn't fire (or fired in the wrong place).
    // The router only forwards to `wizard` for non-archive prompts, so
    // wizard.calls captures everything else that reached the prompt step.
    expect(
      wizard.calls.length,
      `wizard prompter must not be called once corruption surfaces; got ${wizard.calls.length} calls`,
    ).toBe(0);
  });
});

// ===========================================================================
// AC3 — readAllTasksSync docstring polish. Post-TASK-017 AC7, the regex is
// DRY-imported from src/task-store.js (TASK_FILENAME_RE), so the previous
// docstring claim "Duplicated intentionally — the orchestrator forbade
// widening task-store's public API just for this one read" is actively
// misleading. The fix is a 1-line docstring rewrite; this source-grep
// regression test pins the removal of the stale phrase.
// ===========================================================================
describe('AC3 — readAllTasksSync docstring no longer claims duplication', () => {
  it('source_does_not_contain_stale_duplicated_intentionally_phrase', () => {
    const source = readFileSync(__seederSourcePath, 'utf8');
    // Negative assertion — the phrase must be gone. Tolerate case + an
    // optional em-dash / hyphen after the word so wordsmithing of the
    // replacement docstring doesn't accidentally re-introduce it.
    const stalePhrase = /Duplicated intentionally/i;
    expect(
      stalePhrase.test(source),
      'src/backlog-seeder.js must drop the misleading "Duplicated intentionally" docstring '
        + '(post-AC7 the regex is DRY-imported via TASK_FILENAME_RE)',
    ).toBe(false);
  });
});

// ===========================================================================
// AC4 — the `if (!templates) continue;` line carries an inline comment that
// references TASK-017 AC2's design lock. Today's comment is just
// `// Unknown use case slug — silently ignore.` with no design-lock anchor;
// a future maintainer might read it as accidental and "fix" it by throwing.
// The test is tolerant of phrasing — only the TASK-017 + AC2 anchors are
// required, case-insensitive, in either order.
// ===========================================================================
describe('AC4 — silent-ignore comment references TASK-017 AC2 design lock', () => {
  it('source_comment_near_templates_skip_mentions_task_017_and_ac2', () => {
    const source = readFileSync(__seederSourcePath, 'utf8');

    // Take a tight LINE-BASED window — the comment must be co-located with
    // the continue line, not merely "in the same function". We grab the
    // anchor line itself plus up to 3 lines immediately above it (covers
    // both a trailing same-line comment and a short block comment placed
    // directly above the `if`). This window deliberately excludes:
    //   - the TASK-017 AC1 block comment ~6 lines above (would let an impl
    //     accidentally satisfy the TASK-017 anchor without doing the work);
    //   - the TASK-017 AC6 block comment ~2 lines below (same reason).
    // The implementer MUST place both anchors in the local comment.
    const lines = source.split('\n');
    const anchorLineIdx = lines.findIndex((ln) => ln.includes('if (!templates) continue'));
    expect(
      anchorLineIdx,
      'src/backlog-seeder.js must still contain the `if (!templates) continue` line',
    ).toBeGreaterThan(-1);
    const windowStart = Math.max(0, anchorLineIdx - 3);
    const window = lines.slice(windowStart, anchorLineIdx + 1).join('\n');

    // Tolerant matchers — either token can appear with or without a hyphen,
    // case-insensitive. We require BOTH anchors present in the window.
    const mentionsTask017 = /TASK[-\s]?017/i.test(window);
    const mentionsAc2 = /\bAC[-\s]?2\b/i.test(window);

    expect(
      mentionsTask017,
      'comment near `if (!templates) continue` must reference TASK-017 (the design-lock ticket)',
    ).toBe(true);
    expect(
      mentionsAc2,
      'comment near `if (!templates) continue` must reference AC2 (the design-lock acceptance criterion)',
    ).toBe(true);
  });
});
