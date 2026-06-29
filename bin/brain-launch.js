#!/usr/bin/env node
// brain-launch — bring up the wisearch "brain" and exec its MCP stdio server, OR (with
// --health) print a one-shot kb_health probe. hivemind's brain-client spawns this on demand
// (rather than a committed .mcp.json entry) because the wisearch repo lives OUTSIDE the
// plugin root and its path must be resolved at runtime. Docker bring-up is best-effort: if it
// fails the MCP still starts and kb_health reports what is down, so the client degrades to the
// grep KB. Zero-dependency Node so it can ship/run without a build step.
//
// ANTHROPIC_API_KEY is stripped from the child env (subscription CLI auth only); VOYAGE_API_KEY
// and the Neo4j/Qdrant settings pass through.

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

/** Resolve the wisearch repo: WISEARCH_PATH wins; else discover as a sibling. */
export function resolveWisearchPath({ env = process.env, exists = existsSync } = {}) {
  if (env.WISEARCH_PATH) {
    const p = resolve(env.WISEARCH_PATH);
    if (!exists(join(p, 'wisearch', 'mcp_server.py'))) {
      throw new Error(`WISEARCH_PATH has no wisearch/mcp_server.py: ${p}`);
    }
    return p;
  }
  const roots = [env.CLAUDE_PLUGIN_ROOT, env.CLAUDE_PROJECT_DIR, process.cwd()].filter(Boolean);
  for (const r of roots) {
    for (const cand of [join(r, '..', 'wisearch'), join(r, '..', '..', 'wisearch')]) {
      if (exists(join(cand, 'wisearch', 'mcp_server.py'))) return resolve(cand);
    }
  }
  throw new Error('could not resolve the wisearch repo; set WISEARCH_PATH');
}

/** Build the docker / MCP / python commands from a resolved wisearch path (pure). */
export function buildLaunchPlan({ wisearchPath, exists = existsSync } = {}) {
  const compose = join(wisearchPath, 'docker-compose.yml');
  const venvBin = join(wisearchPath, '.venv', 'bin');
  const venvScript = join(venvBin, 'wisearch-mcp');
  const venvPython = join(venvBin, 'python');
  const python = exists(venvPython) ? venvPython : 'python3';

  let mcp;
  if (exists(venvScript)) mcp = { command: venvScript, args: [] };
  else if (exists(venvPython)) mcp = { command: venvPython, args: ['-m', 'wisearch.mcp_server'] };
  else mcp = { command: 'wisearch-mcp', args: [] }; // rely on PATH

  return {
    docker: exists(compose)
      ? { command: 'docker', args: ['compose', '-f', compose, 'up', '-d'] }
      : null,
    mcp: { ...mcp, cwd: wisearchPath },
    python: { command: python, args: [], cwd: wisearchPath },
  };
}

/** Child env with ANTHROPIC_API_KEY stripped (subscription auth only). */
export function childEnv(env = process.env) {
  const e = { ...env };
  delete e.ANTHROPIC_API_KEY;
  return e;
}

function bringUpDocker(plan) {
  if (!plan.docker) return;
  const r = spawnSync(plan.docker.command, plan.docker.args, {
    stdio: ['ignore', 'ignore', 'inherit'], env: childEnv(),
  });
  if (r.status !== 0) {
    process.stderr.write('[brain-launch] docker compose up failed; continuing (kb_health will report)\n');
  }
}

function runHealth(plan) {
  bringUpDocker(plan);
  const code = 'from wisearch.mcp_server import kb_health, build_engine; import json; print(json.dumps(kb_health(build_engine())))';
  const r = spawnSync(plan.python.command, ['-c', code], {
    cwd: plan.python.cwd, env: childEnv(), stdio: ['ignore', 'inherit', 'inherit'],
  });
  process.exit(r.status ?? 1);
}

function execMcp(plan) {
  bringUpDocker(plan);
  const child = spawn(plan.mcp.command, plan.mcp.args, {
    cwd: plan.mcp.cwd, env: childEnv(), stdio: 'inherit',
  });
  child.on('exit', (code) => process.exit(code ?? 0));
  child.on('error', (err) => {
    process.stderr.write(`[brain-launch] failed to exec the MCP server: ${err.message}\n`);
    process.exit(127);
  });
}

function main(argv = process.argv.slice(2)) {
  let plan;
  try {
    plan = buildLaunchPlan({ wisearchPath: resolveWisearchPath() });
  } catch (err) {
    process.stderr.write(`[brain-launch] ${err.message}\n`);
    process.exit(2);
  }
  if (argv.includes('--health')) runHealth(plan);
  else execMcp(plan);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
