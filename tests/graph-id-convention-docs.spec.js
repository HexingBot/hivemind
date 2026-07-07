// tests/graph-id-convention-docs.spec.js
// TASK-104 AC1 — one canonical id convention documented IDENTICALLY in BOTH
// SKILL.md sites (orchestrator-routing close-protocol section and the
// graphify skill's Node Types section). Locks the R17 fix: the two sites no
// longer contradict each other (TASK-035-style keys + raw ISO decision
// timestamps in one vs slugs in the other).
//
// TESTS-FIRST FAILURE SURFACE:
//   The canonical-shapes table does not exist yet in either file -> the
//   literal CANONICAL_SHAPES_BLOCK substring is absent from all four paths,
//   and the old contradicting phrase is still present in orchestrator-routing
//   -> both assertions fail for the right reason.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';

const ORCHESTRATOR_SKILL_PATHS = [
  join(REPO_ROOT, '.claude', 'skills', 'orchestrator-routing', 'SKILL.md'),
  join(REPO_ROOT, 'skills', 'orchestrator-routing', 'SKILL.md'),
];
const GRAPHIFY_SKILL_PATHS = [
  join(REPO_ROOT, '.claude', 'skills', 'graphify', 'SKILL.md'),
  join(REPO_ROOT, 'skills', 'graphify', 'SKILL.md'),
];
const ALL_SKILL_PATHS = [...ORCHESTRATOR_SKILL_PATHS, ...GRAPHIFY_SKILL_PATHS];

// The canonical-shapes table + explanatory paragraph MUST be byte-identical
// across all four sites — this is the literal text the Developer inserted
// into each SKILL.md. If a future edit lets one copy drift, this constant and
// the file no longer match and the "byte-identical" test below fails.
//
// TASK-105 rider R-b — a sentence on the addNode slug-collision remedy was
// folded into this shared block (updated in lockstep across all four sites,
// per the same drift-guard this constant already enforces).
const CANONICAL_SHAPES_BLOCK = `| node type          | id shape                     | example                                          |
|--------------------|-------------------------------|---------------------------------------------------|
| \`task\`             | \`task-<digits>\`               | \`task-104\`                                         |
| \`decision\`         | \`decision-<YYYYMMDD>-<slug>\`  | \`decision-20260704-release-v0-10-0-minor-bump\`     |
| \`skill\`            | \`skill-<slug>\`                | \`skill-graphify\`                                   |
| \`knowledge_entry\`  | \`ke-<slug>\`                   | \`ke-windows-atomic-rename\`                         |

\`<slug>\` is lowercase, hyphen-separated, \`[a-z0-9-]+\` only — never a raw ISO
timestamp and never an uppercase task key (e.g. \`TASK-104\`). Derive/validate
mechanically via \`canonicalIdPattern\`/\`isCanonicalId\`/\`deriveCanonicalId\` in
\`src/graph-id-migration.js\` rather than hand-rolling the convention. On an
\`addNode\` slug-collision rejection (the id is already in use), add a
distinguishing word to the \`<slug>\` rather than reusing or overloading the
existing id.`;

describe('TASK-104 AC1 — canonical id convention documented identically in both SKILL.md sites', () => {
  it.each(ALL_SKILL_PATHS)('%s: exists', (path) => {
    expect(existsSync(path), `${path} must exist`).toBe(true);
  });

  it.each(ALL_SKILL_PATHS)('%s: contains the canonical-shapes block verbatim', (path) => {
    const text = readFileSync(path, 'utf8');
    expect(
      text.includes(CANONICAL_SHAPES_BLOCK),
      `${path} must contain the canonical-shapes block byte-identical to the shared reference text`,
    ).toBe(true);
  });

  it('the canonical-shapes block is byte-identical across all four SKILL.md sites (cross-file, not just parity-pair)', () => {
    const occurrences = ALL_SKILL_PATHS.map((p) => readFileSync(p, 'utf8').includes(CANONICAL_SHAPES_BLOCK));
    expect(occurrences.every(Boolean), 'every site must contain the exact same canonical-shapes block').toBe(true);
  });

  it.each(ORCHESTRATOR_SKILL_PATHS)(
    '%s: no longer mandates the old contradicting uppercase TASK-<key> task id form',
    (path) => {
      const text = readFileSync(path, 'utf8');
      // The OLD R17 contradiction: "id = the task key e.g. `TASK-035`" — must be gone.
      expect(text).not.toMatch(/id = the task key e\.g\. `TASK-035`/);
    },
  );

  it.each(ORCHESTRATOR_SKILL_PATHS)(
    '%s: no longer mandates a raw ISO timestamp as the decision id',
    (path) => {
      const text = readFileSync(path, 'utf8');
      // The OLD R17 contradiction: "id = the decision's ISO timestamp" — must be gone.
      expect(text).not.toMatch(/id = the decision's ISO timestamp/);
    },
  );
});
