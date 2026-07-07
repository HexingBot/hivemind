// tests/knowledge-capture-docs.spec.js
// TASK-105 AC2 — the ticket-close protocol (both orchestrator-routing SKILL.md
// copies + CLAUDE.md workflow step 7) documents a capture step: a reviewer
// HIGH finding or an RC (REQUEST-CHANGES) loop on a ticket produces a draft
// knowledge entry at close, written by the Orchestrator WITHOUT per-entry
// human approval.
// TASK-105 AC4 — Gate 5 (commands/loop.md + the SKILL.md gate list) no longer
// documents auto_consolidate as silently skipping knowledge work; the
// human's role is documented as batched promote/discard at consolidation.
// TASK-105 AC5 — the KB-first read contract now points at a real write path;
// the SKILL.md knowledge sections document when entries get created, by
// whom, and how promotion works.
// TASK-105 AC3 — the design decision (knowledge/proposed/ directory over a
// vetted:false flag) is recorded explicitly in the entry-format docs.
// TASK-105 rider R-d — graphify SKILL.md frontmatter (both copies) gains
// source_tier, silencing the pre-existing check:calibration FLAG (a doc
// carrying epistemic markers with no source_tier).
//
// TESTS-FIRST FAILURE SURFACE:
//   None of the new prose exists yet in CLAUDE.md, either orchestrator-routing
//   SKILL.md copy, commands/loop.md, or knowledge/schema.md -> every
//   text.includes(...)/regex assertion below fails for the right reason
//   (doc not written yet). graphify SKILL.md frontmatter has no source_tier
//   line yet -> validateTiers reports the pre-existing FLAG.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';
import { validateTiers } from '../src/calibration.js';
import { canonicalIdPattern } from '../src/graph-id-migration.js';

const CLAUDE_MD_PATH = join(REPO_ROOT, 'CLAUDE.md');
const ORCHESTRATOR_SKILL_PATHS = [
  join(REPO_ROOT, '.claude', 'skills', 'orchestrator-routing', 'SKILL.md'),
  join(REPO_ROOT, 'skills', 'orchestrator-routing', 'SKILL.md'),
];
const GRAPHIFY_SKILL_PATHS = [
  join(REPO_ROOT, '.claude', 'skills', 'graphify', 'SKILL.md'),
  join(REPO_ROOT, 'skills', 'graphify', 'SKILL.md'),
];
const RESEARCHER_PATHS = [
  join(REPO_ROOT, '.claude', 'agents', 'researcher.md'),
  join(REPO_ROOT, 'agents', 'researcher.md'),
];
const LOOP_MD_PATH = join(REPO_ROOT, 'commands', 'loop.md');
const SCHEMA_MD_PATH = join(REPO_ROOT, 'knowledge', 'schema.md');

function load(path) {
  return readFileSync(path, 'utf8');
}

function normalize(text) {
  return text.replace(/\s+/g, ' ');
}

describe('TASK-105 AC2 — CLAUDE.md Workflow step 7 documents the capture step', () => {
  it('step 7 names writeKnowledgeEntry, the HIGH/RC-loop trigger, and no per-entry approval', () => {
    const text = normalize(load(CLAUDE_MD_PATH));
    const step7Idx = text.indexOf('**Update the ticket.**');
    expect(step7Idx, 'Workflow step 7 must be present').toBeGreaterThan(-1);
    const step7 = text.slice(step7Idx);

    expect(step7).toMatch(/writeKnowledgeEntry/);
    expect(step7).toMatch(/HIGH/);
    expect(/RC loop|REQUEST-CHANGES/.test(step7)).toBe(true);
    expect(/without per-entry human approval/i.test(step7)).toBe(true);
  });
});

describe('TASK-105 AC2/AC5 — orchestrator-routing SKILL.md carries a "Knowledge capture at ticket close" section (both copies)', () => {
  it.each(ORCHESTRATOR_SKILL_PATHS)('%s: contains the new section heading', (path) => {
    const text = load(path);
    expect(text.includes('## Knowledge capture at ticket close')).toBe(true);
  });

  it.each(ORCHESTRATOR_SKILL_PATHS)('%s: documents the trigger (HIGH finding or RC loop, no per-entry approval)', (path) => {
    const text = normalize(load(path));
    expect(/HIGH-severity finding/.test(text)).toBe(true);
    expect(/REQUEST-CHANGES.*RC.*loop|RC.*loop/i.test(text)).toBe(true);
    expect(/without per-entry human approval/i.test(text)).toBe(true);
  });

  it.each(ORCHESTRATOR_SKILL_PATHS)('%s: names the write path and default draft location', (path) => {
    const text = load(path);
    expect(text).toMatch(/writeKnowledgeEntry\(\{ repoRoot, entry, draft: true \}\)/);
    expect(text).toMatch(/knowledge\/proposed\//);
  });

  it.each(ORCHESTRATOR_SKILL_PATHS)('%s: documents promotion as batched, human-curated (not per-entry approval)', (path) => {
    const text = normalize(load(path));
    expect(/curator, not scribe/.test(text)).toBe(true);
    expect(/draft: false/.test(text)).toBe(true);
  });

  // TASK-111 AC5 (LOW punch-list item): the previous version of this spec
  // only asserted the literal substring "ke-<slug>" is present in prose — a
  // hand-authored string checking itself, which can never go red from an
  // actual code/doc drift (e.g. the canonical pattern changing shape, or the
  // doc's concrete example becoming malformed). Repointed to extract the
  // doc's own concrete example id and validate it against the REAL canonical
  // pattern in src/graph-id-migration.js, so this now fails if either side
  // drifts from the other.
  it.each(ORCHESTRATOR_SKILL_PATHS)('%s: the doc\'s concrete ke-<slug> example id matches the real canonical pattern', (path) => {
    const text = load(path);
    const match = text.match(/`(ke-[a-z0-9-]+)`/);
    expect(match, 'doc must cite a concrete `ke-<slug>` example id (e.g. `ke-windows-atomic-rename`)').not.toBeNull();
    expect(canonicalIdPattern('knowledge_entry').test(match[1])).toBe(true);
  });

  it.each(ORCHESTRATOR_SKILL_PATHS)('%s: the promotion recipe names promoteDraftEntry (TASK-111 AC2)', (path) => {
    const text = load(path);
    expect(text).toMatch(/promoteDraftEntry\(\{ repoRoot, id \}\)/);
    expect(text).toMatch(/draft: false/);
  });
});

describe('TASK-111 AC3 — researcher.md proposed_kb_entry offline path routes through writeKnowledgeEntry into knowledge/proposed/', () => {
  it.each(RESEARCHER_PATHS)('%s: names writeKnowledgeEntry and knowledge/proposed/ for the offline draft path', (path) => {
    const text = load(path);
    expect(text).toMatch(/writeKnowledgeEntry\(\{ repoRoot, entry, draft: true \}\)/);
    expect(text).toMatch(/knowledge\/proposed\//);
  });
});

describe('TASK-111 AC4 — loop-ctl drafts-count seam is documented at Gate 5', () => {
  it('commands/loop.md Gate 5 section names the drafts-count subcommand', () => {
    const text = load(LOOP_MD_PATH);
    const idx = text.indexOf('### Gate 5');
    expect(idx, 'Gate 5 section must exist').toBeGreaterThan(-1);
    const section = text.slice(idx, text.indexOf('\n## ', idx) === -1 ? undefined : text.indexOf('\n## ', idx));
    expect(section).toMatch(/loop-ctl(\.cjs)? drafts-count/);
  });
});

describe('TASK-105 AC4 — Gate 5 no longer silently skips knowledge work under auto_consolidate', () => {
  it('commands/loop.md Gate 5 section documents draftEntryCount and draftsPending', () => {
    const text = load(LOOP_MD_PATH);
    const idx = text.indexOf('### Gate 5');
    expect(idx, 'Gate 5 section must exist').toBeGreaterThan(-1);
    const section = text.slice(idx, text.indexOf('\n## ', idx) === -1 ? undefined : text.indexOf('\n## ', idx));
    expect(section).toMatch(/draftEntryCount/);
    expect(section).toMatch(/draftsPending/);
    expect(normalize(section)).toMatch(/curator, not scribe/);
  });

  it.each(ORCHESTRATOR_SKILL_PATHS)('%s: the five-gate list documents draftsPending surfacing under auto_consolidate', (path) => {
    const text = normalize(load(path));
    expect(/draftsPending/.test(text)).toBe(true);
  });
});

describe('TASK-105 AC3 — the draft-vs-vetted design decision is recorded in the entry-format docs', () => {
  it('knowledge/schema.md documents the knowledge/proposed/ directory decision over a vetted:false flag', () => {
    const text = normalize(load(SCHEMA_MD_PATH));
    expect(text).toMatch(/knowledge\/proposed\//);
    expect(/vetted: ?false/i.test(text)).toBe(true);
    expect(/excluded from ranking|excluded.*by construction/i.test(text)).toBe(true);
  });

  it('knowledge/schema.md promotion recipe names promoteDraftEntry (TASK-111 AC2 — was two manual non-atomic steps)', () => {
    const text = load(SCHEMA_MD_PATH);
    expect(text).toMatch(/promoteDraftEntry\(\{ repoRoot, id \}\)/);
  });
});

describe('TASK-105 rider R-d — graphify SKILL.md frontmatter gains source_tier (silences the pre-existing calibration FLAG)', () => {
  it.each(GRAPHIFY_SKILL_PATHS)('%s: source_tier frontmatter is present and valid', (path) => {
    const text = load(path);
    expect(/^source_tier:\s*T[1-4X]\s*$/m.test(text)).toBe(true);
  });

  it.each(GRAPHIFY_SKILL_PATHS)('%s: validateTiers reports no findings once source_tier is set', (path) => {
    const relPath = path.replace(REPO_ROOT, '').replace(/\\/g, '/').replace(/^\//, '');
    const text = load(path);
    expect(validateTiers(relPath, text)).toEqual([]);
  });
});
