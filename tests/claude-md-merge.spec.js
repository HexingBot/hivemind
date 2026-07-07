// tests/claude-md-merge.spec.js
// TASK-025 — Plugin chain P5: the project-level CLAUDE.md routing write.
//
// Authoritative design: tasks/TASK-025.json AC1/AC2 + the human-locked policy
// "PROMPT-ONCE then marker-delimited merge". A plugin-root CLAUDE.md is NOT
// loaded as orchestrator context, so /init-project must MERGE an activation
// block into the user's project-level CLAUDE.md. The user's own content is
// sacred — it is never clobbered; only a fenced marker block is owned by us.
//
// PINNED MECHANISM (testable, no disk I/O for the unit layer):
//   src/claude-md.js exports
//     • BEGIN_MARKER / END_MARKER — the EXACT delimiter lines:
//         <!-- BEGIN hivemind routing -->
//         <!-- END hivemind routing -->
//     • mergeRoutingBlock(existingContent | null, routingBlockContent) -> string
//         a PURE function: given the current file text (or null when absent) and
//         the inner routing content, return the new full file text. Exactly ONE
//         marker block; user content outside the block preserved byte-for-byte;
//         idempotent (re-merging the same content yields identical bytes); a
//         re-merge replaces ONLY the marked block.
//     • routingBlockContent() -> string — the condensed canonical orchestrator
//         activation (RESUME-FIRST four-step + First-chat routing + workflow loop
//         + repo etiquette), sourced to the v2 pointer+bundle model.
//
// TESTS-FIRST: src/claude-md.js does not exist yet, so the dynamic import below
// fails with module-not-found — the RIGHT failure. Once the module lands, each
// case asserts the merge invariants directly.

import { describe, it, expect } from 'vitest';

import { PROD } from './helpers/fixtures.js';

const BEGIN = '<!-- BEGIN hivemind routing -->';
const END = '<!-- END hivemind routing -->';

// A stand-in inner routing content for the pure-function cases. The merge logic
// must be agnostic to the exact body; routingBlockContent()'s wording is
// asserted separately below.
const ROUTING = 'RESUME-FIRST routing block body (test fixture)\nsecond line';

/** Count non-overlapping occurrences of a marker line in some text. */
function countOccurrences(text, marker) {
  return text.split(marker).length - 1;
}

/** Extract the inner text strictly between the first BEGIN and the next END. */
function innerBlock(text) {
  const b = text.indexOf(BEGIN);
  const e = text.indexOf(END);
  if (b === -1 || e === -1) return null;
  return text.slice(b + BEGIN.length, e);
}

describe('AC1 — claude-md.js exports the exact markers', () => {
  it('begin_and_end_markers_are_the_pinned_strings', async () => {
    const mod = await import(PROD.claudeMd);
    expect(mod.BEGIN_MARKER).toBe(BEGIN);
    expect(mod.END_MARKER).toBe(END);
  });
});

describe('AC1 — mergeRoutingBlock pure merge: the four cases', () => {
  it('case_a_absent_file_creates_one_marker_block_with_the_routing_content', async () => {
    const { mergeRoutingBlock } = await import(PROD.claudeMd);
    const out = mergeRoutingBlock(null, ROUTING);

    expect(typeof out).toBe('string');
    expect(out.includes(BEGIN)).toBe(true);
    expect(out.includes(END)).toBe(true);
    // Exactly one block, never nested/duplicated.
    expect(countOccurrences(out, BEGIN)).toBe(1);
    expect(countOccurrences(out, END)).toBe(1);
    // The routing content lives inside the block.
    expect(innerBlock(out).includes(ROUTING)).toBe(true);
  });

  it('case_b_present_user_content_appends_block_and_preserves_user_text_verbatim', async () => {
    const { mergeRoutingBlock } = await import(PROD.claudeMd);
    const userContent = '# My Project\n\nSome rules I wrote.\n\n- do this\n- not that\n';
    const out = mergeRoutingBlock(userContent, ROUTING);

    // The user's pre-existing content survives byte-for-byte (verbatim substring).
    expect(out.includes(userContent)).toBe(true);
    // A single marker block was appended.
    expect(countOccurrences(out, BEGIN)).toBe(1);
    expect(countOccurrences(out, END)).toBe(1);
    // The block comes AFTER the user content (append semantics).
    expect(out.indexOf(BEGIN)).toBeGreaterThan(out.indexOf('not that'));
    expect(innerBlock(out).includes(ROUTING)).toBe(true);
  });

  it('case_c_decline_is_a_no_op_on_the_pure_layer_caller_simply_does_not_call_merge', async () => {
    // The pure function has no notion of consent; "decline → no write" is the
    // CALLER's contract (asserted in the runInit integration spec). Here we only
    // pin the invariant the caller relies on: merging is the ONLY thing that adds
    // a block, so NOT calling it leaves content untouched. We assert merge is a
    // function so the caller has something to gate on consent.
    const { mergeRoutingBlock } = await import(PROD.claudeMd);
    expect(typeof mergeRoutingBlock).toBe('function');
  });

  it('case_d_rerun_replaces_only_the_marked_block_and_is_idempotent', async () => {
    const { mergeRoutingBlock } = await import(PROD.claudeMd);
    const userContent = '# My Project\n\nUser preamble.\n';

    // First merge.
    const once = mergeRoutingBlock(userContent, ROUTING);
    // Re-merge with the SAME routing content → byte-identical (idempotent).
    const twice = mergeRoutingBlock(once, ROUTING);
    expect(twice).toBe(once);

    // Re-merge with DIFFERENT routing content → only the block changes.
    const NEW_ROUTING = 'UPDATED routing block body\nwith new guidance';
    const updated = mergeRoutingBlock(once, NEW_ROUTING);
    // Still exactly one block (never nested/duplicated on re-run).
    expect(countOccurrences(updated, BEGIN)).toBe(1);
    expect(countOccurrences(updated, END)).toBe(1);
    // The new content is in; the old content is gone.
    expect(innerBlock(updated).includes('UPDATED routing block body')).toBe(true);
    expect(innerBlock(updated).includes(ROUTING)).toBe(false);

    // Everything OUTSIDE the block is byte-identical across the re-run: split on
    // the block and compare the prefix + suffix.
    const onceBefore = once.slice(0, once.indexOf(BEGIN));
    const onceAfter = once.slice(once.indexOf(END) + END.length);
    const updBefore = updated.slice(0, updated.indexOf(BEGIN));
    const updAfter = updated.slice(updated.indexOf(END) + END.length);
    expect(updBefore).toBe(onceBefore);
    expect(updAfter).toBe(onceAfter);
  });
});

describe('AC2 — collision safety: bytes outside the block survive init + re-init', () => {
  it('substantial_user_content_is_preserved_byte_for_byte_across_two_merges', async () => {
    const { mergeRoutingBlock } = await import(PROD.claudeMd);
    // A substantial, structurally varied user CLAUDE.md (headings, code fence,
    // a stray HTML comment that is NOT our marker, trailing whitespace).
    const userContent = [
      '# Acme Service',
      '',
      'House rules for this repo.',
      '',
      '<!-- a comment that is not our marker -->',
      '',
      '```bash',
      'npm run build',
      '```',
      '',
      '## Conventions',
      '- two-space indent',
      '- no console.log in prod   ',
      '',
    ].join('\n');

    // init (first write).
    const afterInit = mergeRoutingBlock(userContent, ROUTING);
    // re-init (second write, different content to force a block replacement).
    const afterReinit = mergeRoutingBlock(afterInit, 'totally different routing v2');

    // The user's content (everything before our block) is byte-identical to the
    // ORIGINAL across both operations.
    const prefixInit = afterInit.slice(0, afterInit.indexOf(BEGIN));
    const prefixReinit = afterReinit.slice(0, afterReinit.indexOf(BEGIN));
    expect(prefixInit).toBe(prefixReinit);
    // And the original user content is still present verbatim.
    expect(afterReinit.includes(userContent)).toBe(true);
    // The non-marker HTML comment must NOT have been mistaken for our block.
    expect(afterReinit.includes('<!-- a comment that is not our marker -->')).toBe(true);
    // Still exactly one of OUR marker blocks.
    expect(countOccurrences(afterReinit, BEGIN)).toBe(1);
    expect(countOccurrences(afterReinit, END)).toBe(1);
  });
});

describe('AC1 — routingBlockContent carries the v2 canonical activation', () => {
  it('routing_content_mentions_resume_first_pointer_bundle_and_first_chat_routing', async () => {
    const { routingBlockContent } = await import(PROD.claudeMd);
    const body = routingBlockContent();
    expect(typeof body).toBe('string');
    expect(body.length).toBeGreaterThan(0);

    // RESUME-FIRST four-step sequence + the v2 pointer/bundle model.
    expect(/RESUME[- ]FIRST/i.test(body)).toBe(true);
    expect(body.includes('state/session.json')).toBe(true);
    expect(body.includes('active_session_id')).toBe(true);
    expect(/state\/sessions\//.test(body)).toBe(true);
    // First-chat routing rule: PROJECT.md absent → init.
    expect(body.includes('PROJECT.md')).toBe(true);
    expect(/init/i.test(body)).toBe(true);

    // It must NOT carry the v1 single-file archive scheme (no <updated_at>.json,
    // no idle-template reset language) — the activation we ship must be v2.
    expect(/<updated_at>\.json/.test(body)).toBe(false);
    expect(/sessions\/<updated_at>/.test(body)).toBe(false);
    expect(/idle template/i.test(body)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TASK-102 (R14, F36+F24) — regression lock: the generated routing block a
// user project's CLAUDE.md receives must reflect the tier policy (not an
// unconditional "Tests first"), point at /hivemind:loop, and must not dangle
// a reference to state/README.md — bin/init.js never materializes that file
// into a user project, so a generated pointer to it would be dead on arrival.
// ---------------------------------------------------------------------------
describe('AC4 (TASK-102) — routingBlockContent reflects the tier policy, mentions /hivemind:loop, drops the dead state/README.md pointer', () => {
  it('workflow_step_is_tier_aware_not_an_unconditional_tests_first_mandate', async () => {
    const { routingBlockContent } = await import(PROD.claudeMd);
    const body = routingBlockContent();

    // The old unconditional mandate must be gone.
    expect(
      /Tests first: the `developer` writes failing tests/.test(body),
      'the generated block must not hard-code an unconditional "Tests first" step — the tier policy replaces it',
    ).toBe(false);

    // The three tier names must all be present so the generated block matches
    // the tier rubric (tdd / tests-after / uat-only), not just the tdd path.
    expect(body).toMatch(/\btdd\b/);
    expect(body).toMatch(/\btests-after\b/);
    expect(body).toMatch(/\buat-only\b/);
  });

  it('mentions_the_hivemind_loop_command', async () => {
    const { routingBlockContent } = await import(PROD.claudeMd);
    const body = routingBlockContent();
    expect(body.includes('/hivemind:loop')).toBe(true);
  });

  it('drops_the_dangling_state_readme_reference', async () => {
    const { routingBlockContent } = await import(PROD.claudeMd);
    const body = routingBlockContent();
    // bin/init.js copies workflows/ into a fresh project but never
    // materializes state/README.md there — a generated pointer to it would be
    // a dead link in every project the wizard scaffolds.
    expect(body.includes('state/README.md')).toBe(false);
  });
});
