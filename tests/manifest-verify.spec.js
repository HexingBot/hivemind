import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { runChecks, summarize, buildMatrix } from '../src/manifest-verify.js';
import { REPO_ROOT } from './helpers/repoRoot.js';

const byName = (checks, name) => checks.find((c) => c.name === name);

describe('runChecks — invariants', () => {
  it('all skipped (and passing) when nothing is provided', () => {
    const checks = runChecks({});
    expect(summarize(checks).ok).toBe(true);
    expect(checks).toHaveLength(6);
  });

  it('Scope -> screens fails on an uncovered scope item', () => {
    const fail = runChecks({ scope: 'S-AUTH S-HOME', screens: 'covers S-AUTH only' });
    expect(byName(fail, 'Scope -> screens').pass).toBe(false);
    const ok = runChecks({ scope: 'S-AUTH', screens: 'screen for S-AUTH' });
    expect(byName(ok, 'Scope -> screens').pass).toBe(true);
  });

  it('Blocks -> tasks fails on a missing block', () => {
    expect(byName(runChecks({ estimation: 'B-01 B-02', blockTasks: 'B-01 only' }), 'Blocks -> tasks').pass).toBe(false);
  });

  it('Screen endpoints -> contracts flags an orphan endpoint', () => {
    const fail = runChecks({ screens: 'calls GET /campaigns', contracts: '(no contracts table)' });
    expect(byName(fail, 'Screen endpoints -> contracts').pass).toBe(false);
    const ok = runChecks({ screens: 'calls GET /campaigns?page=2', contracts: '| GET | /campaigns |' });
    expect(byName(ok, 'Screen endpoints -> contracts').pass).toBe(true); // query string stripped
  });

  it('Gap references valid flags a dangling gap id', () => {
    expect(byName(runChecks({ gaps: 'G-DAT01', screens: 'see G-DAT99' }), 'Gap references valid').pass).toBe(false);
    expect(byName(runChecks({ gaps: 'G-DAT01', screens: 'see G-DAT01' }), 'Gap references valid').pass).toBe(true);
  });

  it('MISSING_INFO traced fails when an untraced marker exists, passes with a gap id or VERIFY log', () => {
    expect(byName(runChecks({ screens: 'rate limit [MISSING_INFO]' }), 'MISSING_INFO traced').pass).toBe(false);
    expect(byName(runChecks({ screens: 'rate limit [MISSING_INFO] G-API01' }), 'MISSING_INFO traced').pass).toBe(true);
    expect(byName(runChecks({ screens: 'x [MISSING_INFO]', verifyDoc: 'logged: [MISSING_INFO]' }), 'MISSING_INFO traced').pass).toBe(true);
  });

  it('Cache/query key parity flags a drifting cache key', () => {
    const fail = runChecks({ contracts: 'cache: ["campaigns", id]', states: 'query: ["users"]' });
    expect(byName(fail, 'Cache/query key parity').pass).toBe(false);
    const ok = runChecks({ contracts: 'cache: ["users", id]', states: 'query: ["users"]' });
    expect(byName(ok, 'Cache/query key parity').pass).toBe(true);
  });
});

describe('buildMatrix', () => {
  it('renders a PASS/FAIL matrix with a deterministic stamp', () => {
    const m = buildMatrix(runChecks({ scope: 'S-A', screens: 'no match' }), { now: '2026-06-24' });
    expect(m).toMatch(/# Verification Matrix/);
    expect(m).toMatch(/\*\*Result\*\*: FAIL \(generated 2026-06-24\)/);
    expect(m).toMatch(/\| Scope -> screens \| FAIL \|/);
  });
});

describe('manifest-verifier skill ships in both mirrors', () => {
  it('byte-identical + frontmatter', () => {
    const plugin = join(REPO_ROOT, 'skills', 'manifest-verifier', 'SKILL.md');
    const dev = join(REPO_ROOT, '.claude', 'skills', 'manifest-verifier', 'SKILL.md');
    expect(existsSync(plugin) && existsSync(dev)).toBe(true);
    const a = readFileSync(plugin, 'utf8');
    expect(a).toBe(readFileSync(dev, 'utf8'));
    expect(/^name:\s*manifest-verifier\b/m.test(a)).toBe(true);
  });
});
