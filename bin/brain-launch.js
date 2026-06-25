#!/usr/bin/env node
// brain-launch — bring up the wisearcher "brain" and exec its MCP stdio server, OR (with
// --health) print a one-shot kb_health probe. hivemind's brain-client spawns this on demand
// (rather than a committed .mcp.json entry) because the wisearcher repo lives OUTSIDE the
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

/** Resolve the wisearcher repo: WISEARCHER_PATH wins; else discover as a sibling. */
export function resolveWisearcherPath({ env = process.env, exists = existsSync } = {}) {
  if (env.WISEARCHER_PATH) {
    const p = resolve(env.WISEARCHER_PATH);
    if (!exists(join(p, 'wisearcher', 'mcp_server.py'))) {
      throw new Error(`WISEARCHER_PATH has no wisearcher/mcp_server.py: ${p}`);
    }
    return p;
  }
  const roots = [env.CLAUDE_PLUGIN_ROOT, env.CLAUDE_PROJECT_DIR, process.cwd()].filter(Boolean);
  for (const r of roots) {
    for (const cand of [join(r, '..', 'wisearcher'), join(r, '..', '..', 'wisearcher')]) {
      if (exists(join(cand, 'wisearcher', 'mcp_server.py'))) return resolve(cand);
    }
  }
  throw new Error('could not resolve the wisearcher repo; set WISEARCHER_PATH');
}

/** Build the docker / MCP / python commands from a resolved wisearcher path (pure). */
export function buildLaunchPlan({ wisearcherPath, exists = existsSync } = {}) {
  const compose = join(wisearcherPath, 'docker-compose.yml');
  const venvBin = join(wisearcherPath, '.venv', 'bin');
  const venvScript = join(venvBin, 'wisearcher-mcp');
  const venvPython = join(venvBin, 'python');
  const python = exists(venvPython) ? venvPython : 'python3';

  let mcp;
  if (exists(venvScript)) mcp = { command: venvScript, args: [] };
  else if (exists(venvPython)) mcp = { command: venvPython, args: ['-m', 'wisearcher.mcp_server'] };
  else mcp = { command: 'wisearcher-mcp', args: [] }; // rely on PATH

  return {
    docker: exists(compose)
      ? { command: 'docker', args: ['compose', '-f', compose, 'up', '-d'] }
      : null,
    mcp: { ...mcp, cwd: wisearcherPath },
    python: { command: python, args: [], cwd: wisearcherPath },
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
  const code = 'from wisearcher.mcp_server import kb_health, build_engine; import json; print(json.dumps(kb_health(build_engine())))';
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
    plan = buildLaunchPlan({ wisearcherPath: resolveWisearcherPath() });
  } catch (err) {
    process.stderr.write(`[brain-launch] ${err.message}\n`);
    process.exit(2);
  }
  if (argv.includes('--health')) runHealth(plan);
  else execMcp(plan);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
