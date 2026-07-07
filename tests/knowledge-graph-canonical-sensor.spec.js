// tests/knowledge-graph-canonical-sensor.spec.js
// TASK-104 AC4 — fast-tier sensor: every node id in knowledge/graph/graph.json
// must match its type's canonical pattern, and every edge endpoint must
// resolve to an existing node.
//
// Red-proven against tests/fixtures/graph-pre-migration-104.json, a FROZEN
// snapshot of the graph as it stood BEFORE the TASK-104 migration (mixed
// TASK-*/task-* task ids + raw-ISO decision timestamps). That fixture must
// always fail validation — it is the evidence the sensor actually detects the
// R17 contradiction, not a tautology.
//
// The LIVE knowledge/graph/graph.json is checked separately and must have ZERO
// violations post-migration — this is the permanent regression lock: any
// future write that reintroduces a non-canonical id or a dangling edge trips
// this test in CI.
//
// TESTS-FIRST FAILURE SURFACE:
//   src/graph-id-migration.js does not exist yet -> import fails ("module not
//   found"). Once it exists but graph.json has not been migrated, the second
//   test fails (live graph still carries the mixed convention).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { validateCanonicalGraph } from '../src/graph-id-migration.js';
import { REPO_ROOT } from './helpers/repoRoot.js';

const FIXTURE_PATH = join(REPO_ROOT, 'tests', 'fixtures', 'graph-pre-migration-104.json');
const LIVE_GRAPH_PATH = join(REPO_ROOT, 'knowledge', 'graph', 'graph.json');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

describe('TASK-104 AC4 — canonical-id sensor', () => {
  it('the frozen pre-migration fixture FAILS canonical validation (proves the sensor detects the R17 contradiction)', () => {
    const fixture = readJson(FIXTURE_PATH);
    const violations = validateCanonicalGraph(fixture);
    expect(
      violations.length,
      'the pre-migration fixture (mixed TASK-*/task-* + raw-ISO decision ids) must trip at least one violation',
    ).toBeGreaterThan(0);
    // Spot-check: at least one violation names a known pre-migration offender.
    expect(violations.some((v) => v.includes('TASK-063'))).toBe(true);
  });

  it('the LIVE knowledge/graph/graph.json has ZERO canonical-id violations post-migration', () => {
    const live = readJson(LIVE_GRAPH_PATH);
    const violations = validateCanonicalGraph(live);
    expect(
      violations,
      `live graph.json must have zero canonical-id violations after the TASK-104 migration:\n${violations.join('\n')}`,
    ).toEqual([]);
  });
});
