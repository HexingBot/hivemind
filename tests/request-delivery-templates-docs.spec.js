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

describe('TASK-229 — the request template (the flow INPUT)', () => {
  it('exists and carries every mandatory block a use case is derived from', () => {
    expect(existsSync(PEDIDO), `${PEDIDO} is missing`).toBe(true);
    const text = read(PEDIDO);
    // The seven blocks named in the ticket's AC1, plus the block->use-case map
    // that makes the derivation mechanical rather than improvised.
    for (const block of [
      'Objetivo',
      'actor',
      'problema',
      'Caminos',
      'Criterios de "hecho"',
      'Restricciones',
      'Fuera de alcance',
    ]) {
      expect(text, `PLANTILLA-PEDIDO.md must define the "${block}" block`)
        .toMatch(new RegExp(block, 'i'));
    }
    // Paths, not only the happy case — the property that makes the list a
    // definition of paths of use instead of an AC restatement.
    expect(text).toMatch(/Alternativo/i);
    expect(text).toMatch(/Fallo/i);
    // The mapping table is what step 2 of the Workflow actually consumes.
    expect(text).toMatch(/Bloque del pedido/);
  });
});

describe('TASK-229 — the delivery template (the flow OUTPUT)', () => {
  it('exists and carries the four blocks a delivery must report', () => {
    expect(existsSync(ENTREGA), `${ENTREGA} is missing`).toBe(true);
    const text = read(ENTREGA);
    expect(text).toMatch(/Casos de uso aprobados/i);
    expect(text).toMatch(/Resultado de la implementacion|Resultado de la implementación/i);
    expect(text).toMatch(/wargaming/i);
    expect(text).toMatch(/UAT/);
    // UAT that was not requested must be stated, never silently omitted.
    expect(text).toMatch(/UAT no solicitado/);
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
