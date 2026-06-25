import { describe, it, expect } from 'vitest';
import { resolveWisearcherPath, buildLaunchPlan, childEnv } from '../bin/brain-launch.js';

const MARKER = ['wisearcher', 'mcp_server.py'].join('/');

describe('resolveWisearcherPath', () => {
  it('honors WISEARCHER_PATH when it holds the engine', () => {
    const env = { WISEARCHER_PATH: '/opt/wisearcher' };
    const exists = (p) => p === '/opt/wisearcher/' + MARKER;
    expect(resolveWisearcherPath({ env, exists })).toBe('/opt/wisearcher');
  });

  it('throws when WISEARCHER_PATH does not hold the engine', () => {
    const env = { WISEARCHER_PATH: '/nope' };
    expect(() => resolveWisearcherPath({ env, exists: () => false })).toThrow(/WISEARCHER_PATH/);
  });

  it('discovers wisearcher as a sibling of the plugin root', () => {
    const env = { CLAUDE_PLUGIN_ROOT: '/a/b' };
    const exists = (p) => p === '/a/wisearcher/' + MARKER;
    expect(resolveWisearcherPath({ env, exists })).toBe('/a/wisearcher');
  });

  it('throws a helpful error when nothing resolves', () => {
    expect(() => resolveWisearcherPath({ env: {}, exists: () => false }))
      .toThrow(/set WISEARCHER_PATH/);
  });
});

describe('buildLaunchPlan', () => {
  const W = '/w';
  const script = '/w/.venv/bin/wisearcher-mcp';
  const py = '/w/.venv/bin/python';
  const compose = '/w/docker-compose.yml';

  it('prefers the venv console script and includes docker bring-up', () => {
    const exists = (p) => [script, py, compose].includes(p);
    const plan = buildLaunchPlan({ wisearcherPath: W, exists });
    expect(plan.mcp).toEqual({ command: script, args: [], cwd: W });
    expect(plan.python.command).toBe(py);
    expect(plan.docker).toEqual({ command: 'docker', args: ['compose', '-f', compose, 'up', '-d'] });
  });

  it('falls back to `python -m wisearcher.mcp_server` when only the venv python exists', () => {
    const exists = (p) => [py, compose].includes(p);
    const plan = buildLaunchPlan({ wisearcherPath: W, exists });
    expect(plan.mcp).toEqual({ command: py, args: ['-m', 'wisearcher.mcp_server'], cwd: W });
  });

  it('falls back to PATH lookups and null docker when nothing is local', () => {
    const plan = buildLaunchPlan({ wisearcherPath: W, exists: () => false });
    expect(plan.mcp.command).toBe('wisearcher-mcp');
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
