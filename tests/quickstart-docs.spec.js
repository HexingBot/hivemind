// tests/quickstart-docs.spec.js
// TASK-027 — Plugin chain P7 (AC2): a non-technical quickstart for the
// PLUGIN-INSTALL workflow.
//
// AC2: "A non-technical quickstart exists (README or docs/) covering
// install → init → first chat with no internal jargon; a reader who has never
// seen the repo can follow it."
//
// The TASK-015 README already documents the CLONE workflow (`git clone` +
// `node bin/init.js`). AC2 wants the CLONE-FREE PLUGIN-INSTALL workflow:
//   install:     `claude plugin marketplace add ...` + `... install ...`
//   init:        `/hivemind:init-project`
//   first chat:  start/resume work in a fresh chat.
//
// LIGHTLY AUTOMATABLE: we assert PRESENCE of the key steps (substrings / the
// install commands / the command name), NOT subjective "is this jargon-free"
// scoring — that judgement is for the human/reviewer. The presence checks keep
// the test objective while still proving the plugin-install path is documented.
//
// SOURCE: the quickstart may live in README.md OR a docs/ file. We scan README
// first, then any docs/*.md, and require the union to contain every step. This
// keeps the impl free to put the plugin quickstart wherever it fits.
//
// TESTS-FIRST: FAILS NOW because no doc yet covers the plugin-INSTALL path. The
// current README targets `node bin/init.js` (clone workflow); the
// `claude plugin marketplace add` / `/hivemind:init-project` install
// quickstart does not exist. Confirm THAT is the failure reason (the install
// command + the slash-command name are absent), not a typo here.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';

const README = join(REPO_ROOT, 'README.md');
const DOCS_DIR = join(REPO_ROOT, 'docs');

/** Concatenate README.md + every docs/*.md so the quickstart can live in either
 *  place. Lower-cased once for case-insensitive substring checks where the
 *  exact casing is not load-bearing. */
function allQuickstartText() {
  let text = existsSync(README) ? readFileSync(README, 'utf8') : '';
  if (existsSync(DOCS_DIR)) {
    for (const name of readdirSync(DOCS_DIR)) {
      if (name.endsWith('.md')) {
        text += '\n' + readFileSync(join(DOCS_DIR, name), 'utf8');
      }
    }
  }
  return text;
}

// ===========================================================================
// AC2 (install) — the clone-free install path is documented.
// FAILS NOW: no doc mentions `claude plugin marketplace add` / `install`.
// ===========================================================================
describe('AC2 — quickstart documents the plugin-install path', () => {
  it('mentions_marketplace_add', () => {
    const text = allQuickstartText();
    expect(
      text.includes('plugin marketplace add'),
      'quickstart must document `claude plugin marketplace add ...` (the install entry point)',
    ).toBe(true);
  });

  it('mentions_plugin_install', () => {
    const text = allQuickstartText();
    // The install step — either `plugin install` or the install verb against the
    // namespaced plugin handle.
    expect(
      /plugin install/.test(text) || /install\s+hivemind@/.test(text),
      'quickstart must document installing `hivemind@hivemind-marketplace`',
    ).toBe(true);
  });
});

// ===========================================================================
// AC2 (init) — the bootstrap slash command is documented.
// FAILS NOW: the README clone path uses `node bin/init.js`, not the command.
// ===========================================================================
describe('AC2 — quickstart documents the /init-project bootstrap command', () => {
  it('mentions_the_init_project_slash_command', () => {
    const text = allQuickstartText();
    expect(
      text.includes('/hivemind:init-project'),
      'quickstart must tell the reader to run `/hivemind:init-project`',
    ).toBe(true);
  });
});

// ===========================================================================
// AC2 (first chat) — starting/resuming work is documented.
// (The current README has a "first chat" section, so this part may already be
//  satisfied; it is included so the quickstart's three-step arc is pinned end
//  to end: install → init → first chat.)
// ===========================================================================
describe('AC2 — quickstart documents the first chat / starting work', () => {
  it('mentions_first_chat_or_starting_work', () => {
    const text = allQuickstartText().toLowerCase();
    expect(
      text.includes('first chat')
        || text.includes('start working')
        || text.includes('starting work')
        || text.includes('your first'),
      'quickstart must cover the first chat / how to start work',
    ).toBe(true);
  });
});
