import { describe, it, expect } from 'vitest';
import { resolveWisearchPath, buildLaunchPlan, childEnv } from '../bin/brain-launch.js';

const MARKER = ['wisearch', 'mcp_server.py'].join('/');

describe('resolveWisearchPath', () => {
  it('honors WISEARCH_PATH when it holds the engine', () => {
    const env = { WISEARCH_PATH: '/opt/wisearch' };
    const exists = (p) => p === '/opt/wisearch/' + MARKER;
    expect(resolveWisearchPath({ env, exists })).toBe('/opt/wisearch');
  });

  it('throws when WISEARCH_PATH does not hold the engine', () => {
    const env = { WISEARCH_PATH: '/nope' };
    expect(() => resolveWisearchPath({ env, exists: () => false })).toThrow(/WISEARCH_PATH/);
  });

  it('discovers wisearch as a sibling of the plugin root', () => {
    const env = { CLAUDE_PLUGIN_ROOT: '/a/b' };
    const exists = (p) => p === '/a/wisearch/' + MARKER;
    expect(resolveWisearchPath({ env, exists })).toBe('/a/wisearch');
  });

  it('throws a helpful error when nothing resolves', () => {
    expect(() => resolveWisearchPath({ env: {}, exists: () => false }))
      .toThrow(/set WISEARCH_PATH/);
  });
});

describe('buildLaunchPlan', () => {
  const W = '/w';
  const script = '/w/.venv/bin/wisearch-mcp';
  const py = '/w/.venv/bin/python';
  const compose = '/w/docker-compose.yml';

  it('prefers the venv console script and includes docker bring-up', () => {
    const exists = (p) => [script, py, compose].includes(p);
    const plan = buildLaunchPlan({ wisearchPath: W, exists });
    expect(plan.mcp).toEqual({ command: script, args: [], cwd: W });
    expect(plan.python.command).toBe(py);
    expect(plan.docker).toEqual({ command: 'docker', args: ['compose', '-f', compose, 'up', '-d'] });
  });

  it('falls back to `python -m wisearch.mcp_server` when only the venv python exists', () => {
    const exists = (p) => [py, compose].includes(p);
    const plan = buildLaunchPlan({ wisearchPath: W, exists });
    expect(plan.mcp).toEqual({ command: py, args: ['-m', 'wisearch.mcp_server'], cwd: W });
  });

  it('falls back to PATH lookups and null docker when nothing is local', () => {
    const plan = buildLaunchPlan({ wisearchPath: W, exists: () => false });
    expect(plan.mcp.command).toBe('wisearch-mcp');
    expect(plan.python.command).toBe('python3');
    expect(plan.docker).toBeNull();
  });
});

describe('childEnv', () => {
  it('strips ANTHROPIC_API_KEY but keeps VOYAGE_API_KEY', () => {
    const out = childEnv({ ANTHROPIC_API_KEY: 'secret', VOYAGE_API_KEY: 'v', PATH: '/bin' });
    expect(out).toEqual({ VOYAGE_API_KEY: 'v', PATH: '/bin' });
  });
});
