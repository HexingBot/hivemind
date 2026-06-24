// tests/claude-md-init.spec.js
// TASK-025 — Plugin chain P5: runInit's CLAUDE.md routing write (integration).
//
// AC1 four consent cases + AC2 collision safety, driven END-TO-END through
// runInit against a temp project dir. This is the disk-level companion to the
// pure-merge unit spec (tests/claude-md-merge.spec.js).
//
// CONSENT MODEL (human-locked, no-TTY-aware):
//   • INTERACTIVE (`node bin/init.js`): consent is obtained via a PROMPT-ONCE
//     through the injected prompter. "Prompt once" = the consent prompt fires
//     ONLY when there is no existing marker block (the first write). A re-run
//     that finds an existing block replaces it WITHOUT re-prompting.
//   • ANSWERS-MODE (the Bash-tool /init-project path): the prompter must NEVER
//     be called. Consent arrives as an explicit signal — a key in the answers
//     object (and/or a --claude-md-consent CLI flag). With consent true the
//     block is written WITHOUT prompting; with the signal absent/false NO block
//     is written.
//
// TESTS-FIRST: runInit has no CLAUDE.md write yet, so:
//   • the "writes a block" cases FAIL because no marker block appears;
//   • the "prompts once" case FAILS because the consent prompter is never called
//     (or the marker never appears);
//   • the "no write on decline / no signal" cases PASS trivially today (no write
//     happens) and must KEEP passing after impl — they are the guard rails.
// Each failure is a "right" failure (missing behavior), not a typo here.

import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { PROD } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';
import { webSaasAnswers } from '../helpers/scripted-prompter.js';

afterAll(cleanupAll);

const FIXED_NOW = '2026-05-28T12:00:00Z';
const BEGIN = '<!-- BEGIN hivemind routing -->';
const END = '<!-- END hivemind routing -->';

function countOccurrences(text, marker) {
  return text.split(marker).length - 1;
}

function claudeMdPath(repoDir) {
  return join(repoDir, 'CLAUDE.md');
}

// A prompter that throws if invoked — proves the answers path does NO prompting.
function throwIfCalled() {
  return async (ctx) => {
    throw new Error(`prompter was called unexpectedly with: ${JSON.stringify(ctx)}`);
  };
}

// A prompter that ONLY answers the CLAUDE.md consent prompt (Y), and records
// every call so we can assert prompt-once. It throws on any non-consent prompt
// so a stray intake prompt would surface — answers-mode bypasses the wizard.
function consentPrompter(answer = 'y') {
  const calls = [];
  const fn = async (ctx) => {
    calls.push(ctx);
    const text = (ctx && ctx.prompt) || '';
    if (/CLAUDE\.md|routing|orchestrator activation|activate/i.test(text)) {
      return answer;
    }
    throw new Error(`unexpected non-consent prompt: ${JSON.stringify(ctx)}`);
  };
  fn.calls = calls;
  // How many times the consent prompt specifically fired.
  fn.consentPromptCount = () =>
    calls.filter((c) => /CLAUDE\.md|routing|orchestrator activation|activate/i.test((c && c.prompt) || '')).length;
  return fn;
}

// ===========================================================================
// AC1 — answers-mode (no TTY): consent via signal, prompter NEVER called.
// ===========================================================================
describe('AC1 — answers-mode CLAUDE.md write is gated by an explicit consent signal', () => {
  it('case_a_answers_mode_consent_true_writes_the_block_without_prompting', async () => {
    const { runInit } = await import(PROD.init);
    const repoDir = makeTmpDir('af-cmdmd-ans-yes');

    await runInit({
      argv: ['--claude-md-consent'],
      answers: { ...webSaasAnswers({ project_name: 'cm-yes' }), claude_md_consent: true },
      prompter: throwIfCalled(), // MUST NOT be called in answers mode
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    const p = claudeMdPath(repoDir);
    expect(existsSync(p), 'CLAUDE.md must be created on consent').toBe(true);
    const text = readFileSync(p, 'utf8');
    expect(countOccurrences(text, BEGIN)).toBe(1);
    expect(countOccurrences(text, END)).toBe(1);
    // The shipped activation must be v2 (the canonical routingBlockContent).
    expect(text.includes('active_session_id')).toBe(true);
    expect(/RESUME[- ]FIRST/i.test(text)).toBe(true);
  });

  it('case_c_answers_mode_no_consent_signal_writes_NO_block', async () => {
    const { runInit } = await import(PROD.init);
    const repoDir = makeTmpDir('af-cmdmd-ans-no');

    await runInit({
      argv: [],
      // No claude_md_consent key and no --claude-md-consent flag.
      answers: webSaasAnswers({ project_name: 'cm-no' }),
      prompter: throwIfCalled(),
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    const p = claudeMdPath(repoDir);
    // Either no CLAUDE.md at all, or one without our block — but NEVER our block.
    if (existsSync(p)) {
      const text = readFileSync(p, 'utf8');
      expect(countOccurrences(text, BEGIN)).toBe(0);
    } else {
      expect(existsSync(p)).toBe(false);
    }
  });
});

// ===========================================================================
// AC1 — interactive mode: PROMPT-ONCE.
// ===========================================================================
describe('AC1 — interactive CLAUDE.md write prompts once then merges', () => {
  it('case_b_present_user_content_consent_appends_block_preserving_user_text', async () => {
    const { runInit } = await import(PROD.init);
    const repoDir = makeTmpDir('af-cmdmd-int-present');

    // Pre-existing user CLAUDE.md with NO marker block.
    const userContent = '# Existing Project\n\nMy own house rules.\n- keep it tidy\n';
    writeFileSync(claudeMdPath(repoDir), userContent, 'utf8');

    const prompter = consentPrompter('y');
    await runInit({
      argv: [],
      // Interactive: answers come from the wizard. We script consent via the
      // prompter; the intake answers are supplied so the wizard does not block
      // on stack questions (the consentPrompter throws on non-consent prompts).
      answers: webSaasAnswers({ project_name: 'cm-int' }),
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    const text = readFileSync(claudeMdPath(repoDir), 'utf8');
    // User content preserved verbatim; one block appended.
    expect(text.includes(userContent)).toBe(true);
    expect(countOccurrences(text, BEGIN)).toBe(1);
    // The consent prompt fired exactly once (no marker existed → prompt).
    expect(prompter.consentPromptCount()).toBe(1);
  });

  it('case_d_rerun_with_existing_block_replaces_without_reprompting', async () => {
    const { runInit } = await import(PROD.init);
    const { routingBlockContent } = await import(PROD.claudeMd);
    const repoDir = makeTmpDir('af-cmdmd-int-rerun');

    // Seed a CLAUDE.md that ALREADY contains a (stale) marker block + user text.
    const userPreamble = '# Seeded\n\nUser preamble kept across re-runs.\n';
    const stale = `${userPreamble}\n${BEGIN}\nSTALE ROUTING CONTENT\n${END}\n`;
    writeFileSync(claudeMdPath(repoDir), stale, 'utf8');

    const prompter = consentPrompter('y');
    await runInit({
      argv: [],
      answers: webSaasAnswers({ project_name: 'cm-rerun' }),
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    const text = readFileSync(claudeMdPath(repoDir), 'utf8');
    // PROMPT-ONCE: an existing block means NO re-prompt.
    expect(prompter.consentPromptCount()).toBe(0);
    // The stale block content was replaced by the canonical routing content.
    expect(text.includes('STALE ROUTING CONTENT')).toBe(false);
    expect(text.includes(routingBlockContent())).toBe(true);
    // Still exactly one block; user preamble preserved.
    expect(countOccurrences(text, BEGIN)).toBe(1);
    expect(text.includes(userPreamble)).toBe(true);
  });

  it('case_c_interactive_decline_writes_NO_block_and_leaves_file_unchanged', async () => {
    const { runInit } = await import(PROD.init);
    const repoDir = makeTmpDir('af-cmdmd-int-decline');

    const userContent = '# Untouched\n\nDo not write into my file.\n';
    writeFileSync(claudeMdPath(repoDir), userContent, 'utf8');
    const before = readFileSync(claudeMdPath(repoDir), 'utf8');

    // Prompter declines the consent question.
    const prompter = consentPrompter('n');
    await runInit({
      argv: [],
      answers: webSaasAnswers({ project_name: 'cm-decline' }),
      prompter,
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });

    const after = readFileSync(claudeMdPath(repoDir), 'utf8');
    // No block written; file byte-for-byte unchanged.
    expect(countOccurrences(after, BEGIN)).toBe(0);
    expect(after).toBe(before);
  });
});

// ===========================================================================
// AC2 — collision safety end-to-end: bytes outside the block survive a real
// init then a real re-init on disk.
// ===========================================================================
describe('AC2 — disk-level collision safety across init + re-init', () => {
  it('user_bytes_outside_the_block_survive_consent_then_reinit', async () => {
    const { runInit } = await import(PROD.init);
    const repoDir = makeTmpDir('af-cmdmd-collision');

    mkdirSync(repoDir, { recursive: true });
    const userContent = [
      '# Substantial User CLAUDE.md',
      '',
      '<!-- not our marker -->',
      '',
      '## Rules',
      '- rule one',
      '- rule two',
      '',
    ].join('\n');
    writeFileSync(claudeMdPath(repoDir), userContent, 'utf8');

    // First init (answers-mode, consent true) writes the block.
    await runInit({
      argv: ['--claude-md-consent'],
      answers: { ...webSaasAnswers({ project_name: 'collide-1' }), claude_md_consent: true },
      prompter: throwIfCalled(),
      repoRoot: repoDir,
      now: () => FIXED_NOW,
    });
    const afterInit = readFileSync(claudeMdPath(repoDir), 'utf8');
    const prefixInit = afterInit.slice(0, afterInit.indexOf(BEGIN));

    // Re-init (force, answers-mode, consent true) replaces only the block.
    await runInit({
      argv: ['--force', '--claude-md-consent'],
      answers: { ...webSaasAnswers({ project_name: 'collide-2' }), claude_md_consent: true },
      prompter: throwIfCalled(),
      repoRoot: repoDir,
      now: () => '2026-05-28T13:00:00Z',
    });
    const afterReinit = readFileSync(claudeMdPath(repoDir), 'utf8');
    const prefixReinit = afterReinit.slice(0, afterReinit.indexOf(BEGIN));

    // Everything before our block is byte-identical across both writes, and the
    // original user content (plus the decoy non-marker comment) is preserved.
    expect(prefixReinit).toBe(prefixInit);
    expect(afterReinit.includes(userContent)).toBe(true);
    expect(afterReinit.includes('<!-- not our marker -->')).toBe(true);
    expect(countOccurrences(afterReinit, BEGIN)).toBe(1);
    expect(countOccurrences(afterReinit, END)).toBe(1);
  });
});
