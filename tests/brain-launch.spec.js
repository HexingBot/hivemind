import { describe, it, expect } from 'vitest';
import { join, resolve } from 'node:path';
import { resolveWisearcherPath, buildLaunchPlan, childEnv } from '../bin/brain-launch.js';

const MARKER = join('wisearcher', 'mcp_server.py');

describe('resolveWisearcherPath', () => {
  it('honors WISEARCHER_PATH when it holds the engine', () => {
    const env = { WISEARCHER_PATH: join('/opt', 'wisearcher') };
    const resolved = resolve(env.WISEARCHER_PATH);
    const exists = (p) => p === join(resolved, MARKER);
    expect(resolveWisearcherPath({ env, exists })).toBe(resolved);
  });

  it('throws when WISEARCHER_PATH does not hold the engine', () => {
    const env = { WISEARCHER_PATH: '/nope' };
    expect(() => resolveWisearcherPath({ env, exists: () => false })).toThrow(/WISEARCHER_PATH/);
  });

  it('discovers wisearcher as a sibling of the plugin root', () => {
    const env = { CLAUDE_PLUGIN_ROOT: join('/a', 'b') };
    // matches the impl: candidates are joined (not resolved) before the exists() probe,
    // and only the winning candidate gets resolve()d for the return value.
    const candidate = join(env.CLAUDE_PLUGIN_ROOT, '..', 'wisearcher');
    const exists = (p) => p === join(candidate, MARKER);
    expect(resolveWisearcherPath({ env, exists })).toBe(resolve(candidate));
  });

  it('throws a helpful error when nothing resolves', () => {
    expect(() => resolveWisearcherPath({ env: {}, exists: () => false }))
      .toThrow(/set WISEARCHER_PATH/);
  });
});

describe('buildLaunchPlan', () => {
  const W = resolve('/w');
  const posixScript = join(W, '.venv', 'bin', 'wisearcher-mcp');
  const posixPython = join(W, '.venv', 'bin', 'python');
  const winScript = join(W, '.venv', 'Scripts', 'wisearcher-mcp.exe');
  const winPython = join(W, '.venv', 'Scripts', 'python.exe');
  const compose = join(W, 'docker-compose.yml');

  it('prefers the venv console script and includes docker bring-up', () => {
    const exists = (p) => [posixScript, posixPython, compose].includes(p);
    const plan = buildLaunchPlan({ wisearcherPath: W, exists });
    expect(plan.mcp).toEqual({ command: posixScript, args: [], cwd: W });
    expect(plan.python.command).toBe(posixPython);
    expect(plan.docker).toEqual({ command: 'docker', args: ['compose', '-f', compose, 'up', '-d'] });
  });

  it('falls back to `python -m wisearcher.mcp_server` when only the venv python exists', () => {
    const exists = (p) => [posixPython, compose].includes(p);
    const plan = buildLaunchPlan({ wisearcherPath: W, exists });
    expect(plan.mcp).toEqual({ command: posixPython, args: ['-m', 'wisearcher.mcp_server'], cwd: W });
  });

  it('resolves the Windows venv layout (.venv/Scripts) when present', () => {
    const exists = (p) => [winScript, winPython].includes(p);
    const plan = buildLaunchPlan({ wisearcherPath: W, exists });
    expect(plan.mcp).toEqual({ command: winScript, args: [], cwd: W });
    expect(plan.python.command).toBe(winPython);
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
