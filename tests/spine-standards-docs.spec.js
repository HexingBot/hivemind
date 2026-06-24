// tests/spine-standards-docs.spec.js
// Phase 4 — the Spine "observable & lean builds" standards are vendored and wired into the
// developer + reviewer prompts. Prose locks for the Done-when: generated code emits spans/logs;
// the reviewer flags gold-plating. (agents-parity.spec.js separately enforces byte-identical
// agent mirrors.)

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './helpers/repoRoot.js';

const read = (...p) => readFileSync(join(REPO_ROOT, ...p), 'utf8');
const agentBothMirrors = (name) => [
  read('agents', name),
  read('.claude', 'agents', name),
];

describe('P4.1 — vendored Spine standards', () => {
  it('OBSERVABILITY.md exists and names OTel → SigNoz + span/log', () => {
    const p = join(REPO_ROOT, '.claude', 'shared', 'OBSERVABILITY.md');
    expect(existsSync(p)).toBe(true);
    const md = readFileSync(p, 'utf8');
    expect(md).toMatch(/OpenTelemetry/);
    expect(md).toMatch(/SigNoz/);
    expect(md).toMatch(/span/i);
    expect(md).toMatch(/structured log/i);
  });

  it('MINIMALISM.md exists and states the Ponytail 6-rung ladder', () => {
    const p = join(REPO_ROOT, '.claude', 'shared', 'MINIMALISM.md');
    expect(existsSync(p)).toBe(true);
    const md = readFileSync(p, 'utf8');
    expect(md).toMatch(/Ponytail/);
    expect(md).toMatch(/Necessity/);
  });
});

describe('P4.2 — agents wired to the standards', () => {
  it('developer requires spans + structured logs and the minimalism ladder', () => {
    for (const md of agentBothMirrors('developer.md')) {
      expect(md).toMatch(/OpenTelemetry|trace span/);
      expect(md).toMatch(/structured log/i);
      expect(md).toMatch(/minimalism|Ponytail/i);
      expect(md).toMatch(/OBSERVABILITY\.md/);
    }
  });

  it('reviewer flags missing observability (BLOCK) and gold-plating', () => {
    for (const md of agentBothMirrors('reviewer.md')) {
      expect(md).toMatch(/gold-plating/i);
      expect(md).toMatch(/observability/i);
      expect(md).toMatch(/MINIMALISM\.md/);
    }
  });
});
