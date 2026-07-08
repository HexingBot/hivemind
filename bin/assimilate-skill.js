#!/usr/bin/env node
// bin/assimilate-skill.js
// TASK-120 — thin invocation path for the hivemind-assimilate-skill UAT: git
// clones a real skill repo (network — NOT exercised by any automated test;
// assimilateSkill()'s own unit/e2e coverage in tests/e2e/assimilate.spec.js
// uses local fixture dirs only) into a tmp dir, then drives the exact same
// assimilateSkill() the tests call. Prints the structured result as JSON.
//
// Usage:
//   node bin/assimilate-skill.js --url <git-url> --resource-id <id> --pack <pack@version> [options]
//
// Options:
//   --subdir <path>        skill's SKILL.md location within the clone (default: clone root)
//   --origin <string>      recorded provenance origin (default: --url)
//   --pin <sha>            recorded provenance pin (default: `git rev-parse HEAD` in the clone)
//   --decision <verdict>   'approve' | 'decline' — re-invoke with this after an awaiting_human verdict
//   --root <path>          repo root to write assimilated-skills/ + integrations.lock.json into (default: cwd)
//   --github-owner <name>  \ repo coordinates for detectLicense's GitHub Licenses API fallback step
//   --github-repo <name>   /

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { assimilateSkill } from '../src/assimilate.js';

const FLAGS_WITH_VALUE = new Set([
  '--url', '--resource-id', '--pack', '--subdir', '--origin', '--pin',
  '--decision', '--root', '--github-owner', '--github-repo',
]);

/** Parse `--flag-name value` pairs into a camelCase-keyed object. */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!FLAGS_WITH_VALUE.has(flag)) throw new Error(`unknown flag: ${flag}`);
    const value = argv[++i];
    if (value === undefined) throw new Error(`flag ${flag} requires a value`);
    out[flag.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
  }
  return out;
}

export async function main(argv) {
  const args = parseArgs(argv);
  if (!args.url || !args.resourceId || !args.pack) {
    throw new Error('--url, --resource-id, and --pack are required');
  }

  const cloneDir = mkdtempSync(join(tmpdir(), 'assimilate-'));
  try {
    execFileSync('git', ['clone', '--quiet', args.url, cloneDir]);
    const pin = args.pin || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: cloneDir, encoding: 'utf8' }).trim();

    const result = await assimilateSkill({
      source: args.subdir ? join(cloneDir, args.subdir) : cloneDir,
      resourceId: args.resourceId,
      pack: args.pack,
      origin: args.origin || args.url,
      pin,
      decision: args.decision,
      root: args.root || process.cwd(),
      github: args.githubOwner && args.githubRepo ? { owner: args.githubOwner, repo: args.githubRepo } : undefined,
    });

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  } finally {
    rmSync(cloneDir, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`[assimilate-skill] ${err.message}\n`);
    process.exit(1);
  });
}
