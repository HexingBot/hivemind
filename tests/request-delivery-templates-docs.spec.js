// tests/request-delivery-templates-docs.spec.js
// TASK-229 — regression lock for the two reinforced ends of the flow
// (2026-09-16 human decision, Mato: "vamos a reforzar la entrada del pedido y
// la salida, y vamos a dejar un poco mas libre movimiento dentro del desarrollo
// mismo").
//
// HARM THIS PREVENTS (Regla 2): the harness tells the Orchestrator to collect
// the initial request with docs/PLANTILLA-PEDIDO.md and to deliver with
// docs/PLANTILLA-ENTREGA.md. If either file is deleted or renamed while those
// instructions stay, the pointer dangles silently and the input step degrades
// back to improvised, unstructured requests — which is exactly the gap this
// ticket exists to close, and with TDD eliminated the use-case list derived
// from that request is the ONLY definition of what a change is supposed to do.
// Same manifest-rot shape as tests/use-case-policy.spec.js.
//
// HARDENED (2026-09-16, wargaming corroboration pass, HIGH finding F1): the
// original version of this spec only checked whole-file EXISTENCE + a
// substring word search with no word-boundary. A wargaming pass killed 12
// mutants but 7 survived — a section deleted while keywords stayed elsewhere
// in the file, an entire template replaced by a 6-11 line keyword stub, and
// "actor" matching only inside "refactor" because the block loop had no word
// boundary (same failure mode TASK-184 fixed for "code"/"hardcoded"). This
// version anchors every assertion to the real markdown HEADING of each block
// (so a section can't be deleted or replaced by a stub without a real heading
// surviving) and, for the two blocks that carry the actual load — PEDIDO
// block 4 (paths) and ENTREGA block 3 (wargaming report) — additionally
// checks the BODY text under that heading, not just its presence anywhere in
// the file. It also adds two reverse-pointer checks (CLAUDE.md's
// "Observable-by-a-person criterion" section and the SKILL's "UAT procedure"
// section, both cited BY these two templates) so renaming either upstream
// anchor is caught here too, where the dangling reference would otherwise go
// unnoticed. Regla 3 cap: this hardens the ONE existing spec file (still 1
// file against the ticket's 6 AC) — no new test file is added.
//
// Only the plugin-root copy of SKILL.md is read for content:
// tests/orchestrator-routing-skill.spec.js already fails on any byte
// divergence against .claude/skills/ (same convention as
// tests/uat-doc-example-lock.spec.js and tests/agility-doc-locks.spec.js).

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';

const PEDIDO = join(REPO_ROOT, 'docs', 'PLANTILLA-PEDIDO.md');
const ENTREGA = join(REPO_ROOT, 'docs', 'PLANTILLA-ENTREGA.md');
const CLAUDE_MD = join(REPO_ROOT, 'CLAUDE.md');
const SKILL = join(REPO_ROOT, 'skills', 'orchestrator-routing', 'SKILL.md');
const DEVELOPER = join(REPO_ROOT, 'agents', 'developer.md');

const read = (p) => readFileSync(p, 'utf8');

// Word-boundary heading match: a real markdown heading line ("### N. ...")
// that carries the keyword as a WHOLE WORD, not a substring match anywhere in
// the file. This is what makes a section-deleted or whole-file-replaced-by-a-
// stub mutant fail: a stub with no real heading, or a heading with the wrong
// number, cannot satisfy this regex no matter what keywords it repeats.
function headingMatches(text, level, number, keyword) {
  const hashes = '#'.repeat(level);
  const re = new RegExp(`^${hashes}\\s+${number}\\.[^\\n]*\\b${keyword}\\b`, 'im');
  return re.test(text);
}

// Extracts the body text of a "### N. Heading" section: everything between
// that heading line and the next "##"/"###" heading (or end of file). Returns
// null if the heading itself cannot be found, so a deleted section fails
// loudly instead of silently checking an empty string.
function sectionBody(text, level, number) {
  const hashes = '#'.repeat(level);
  const lines = text.split('\n');
  const startIdx = lines.findIndex((l) => new RegExp(`^${hashes}\\s+${number}\\.`).test(l));
  if (startIdx === -1) return null;
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i += 1) {
    if (/^#{2,3}\s/.test(lines[i])) {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx + 1, endIdx).join('\n');
}

describe('TASK-229 — the request template (the flow INPUT)', () => {
  it('exists and carries every mandatory block, anchored to real headings', () => {
    expect(existsSync(PEDIDO), `${PEDIDO} is missing`).toBe(true);
    const text = read(PEDIDO);

    // The seven blocks named in the ticket's AC1, anchored to their actual
    // "### N. ..." heading rather than a bare word search over the whole
    // file — a stub template or a deleted section cannot fake a heading.
    const blocks = [
      [1, 'objetivo'],
      [2, 'actor'],
      [3, 'problema'],
      [4, 'Caminos'],
      [5, 'hecho'],
      [6, 'Restricciones'],
      [7, 'alcance'],
    ];
    for (const [number, keyword] of blocks) {
      expect(
        headingMatches(text, 3, number, keyword),
        `PLANTILLA-PEDIDO.md must have a real "### ${number}." heading carrying "${keyword}" as a whole word`
      ).toBe(true);
    }

    // Block 4 is the one the whole policy leans on ("the block use cases are
    // derived from"). Check its BODY, not just its heading, for the three
    // path forms — this is what a heading-preserving-but-body-gutted stub
    // cannot fake.
    const block4 = sectionBody(text, 3, 4);
    expect(block4, 'PLANTILLA-PEDIDO.md block 4 body must exist').not.toBeNull();
    expect(block4).toMatch(/\bPrincipal\b/i);
    expect(block4).toMatch(/\bAlternativo\b/i);
    expect(block4).toMatch(/\bFallo\b/i);

    // The mapping table is what step 2 of the Workflow actually consumes.
    expect(text).toMatch(/Bloque del pedido/);
  });

  it('points at the CLAUDE.md section it cites (reverse pointer, catches an upstream rename)', () => {
    // Block 5 of PLANTILLA-PEDIDO.md cites this CLAUDE.md section by name; a
    // rename over there would leave a dangling citation here with nothing to
    // catch it unless this file also pins the target's existence.
    const claudeText = read(CLAUDE_MD);
    expect(claudeText).toMatch(/^## Observable-by-a-person criterion/m);
    expect(claudeText).toContain('Movimiento libre en el desarrollo');
  });
});

describe('TASK-229 — the delivery template (the flow OUTPUT)', () => {
  it('exists and carries the five blocks a delivery must report, anchored to real headings', () => {
    expect(existsSync(ENTREGA), `${ENTREGA} is missing`).toBe(true);
    const text = read(ENTREGA);

    const blocks = [
      [1, 'aprobados'],
      [2, 'implementacion'],
      [3, 'wargaming'],
      [4, 'UAT'],
      [5, 'deudas'],
    ];
    for (const [number, keyword] of blocks) {
      expect(
        headingMatches(text, 3, number, keyword),
        `PLANTILLA-ENTREGA.md must have a real "### ${number}." heading carrying "${keyword}" as a whole word`
      ).toBe(true);
    }

    // Block 3 (wargaming) is "la verificacion de registro" per the doc's own
    // words — check its BODY for all four required parts, not just that the
    // word "wargaming" appears somewhere in the file.
    const block3 = sectionBody(text, 3, 3);
    expect(block3, 'PLANTILLA-ENTREGA.md block 3 body must exist').not.toBeNull();
    expect(block3).toMatch(/\bataco\b/i);
    expect(block3).toMatch(/\bNO sobrevivio\b/i);
    const survivedMatches = block3.match(/sobrevivio/gi) || [];
    // "Que sobrevivio" AND "Que NO sobrevivio" both use this stem, so a body
    // that only reports one side of the outcome still fails this count.
    expect(survivedMatches.length).toBeGreaterThanOrEqual(2);
    expect(block3).toMatch(/\bVeredicto\b/i);
    expect(block3).toMatch(/e2e/i);

    // UAT that was not requested must be stated, never silently omitted.
    expect(text).toMatch(/UAT no solicitado/);
  });

  it('points at the SKILL.md section it cites (reverse pointer, catches an upstream rename)', () => {
    // Block 4 of PLANTILLA-ENTREGA.md cites the SKILL's "UAT procedure"
    // section by name — check the real heading, not just the phrase, so a
    // rename of the heading itself (leaving stray pointer text elsewhere
    // untouched) still fails here.
    const skillText = read(SKILL);
    expect(skillText).toMatch(/^## UAT procedure\b/m);
  });
});

describe('TASK-229 — the harness points at both ends, and declares the middle free', () => {
  it('CLAUDE.md and the orchestrator-routing skill reference both templates', () => {
    for (const [label, path] of [['CLAUDE.md', CLAUDE_MD], ['SKILL.md', SKILL]]) {
      const text = read(path);
      expect(text, `${label} must route the request through the input template`)
        .toMatch(/docs\/PLANTILLA-PEDIDO\.md/);
      expect(text, `${label} must route the close through the delivery template`)
        .toMatch(/docs\/PLANTILLA-ENTREGA\.md/);
    }
  });

  it('the free-movement rule is stated where the three layers can act on it', () => {
    // The only three obligations of the flow; anything else asked for before
    // implementation is the process gate this policy removed, renamed.
    for (const [label, path] of [
      ['CLAUDE.md', CLAUDE_MD],
      ['SKILL.md', SKILL],
      ['agents/developer.md', DEVELOPER],
    ]) {
      const text = read(path);
      expect(text, `${label} must declare the development middle free`)
        .toMatch(/no hay pasos obligatorios intermedios/i);
    }
  });
});
