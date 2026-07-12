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
//   --decision <verdict>   'approve' | 'decline' — every run defaults to a dry-run vet
//                          (status: pending_approval, writes nothing); re-invoke with
//                          --decision approve to actually adopt. HUMAN-GATE POLICY: no
//                          classification, not even permissive, ever auto-adopts without
//                          this explicit flag.
//   --root <path>          repo root to write assimilated-skills/ + integrations.lock.json into (default: cwd)
//   --github-owner <name>  \ repo coordinates for detectLicense's GitHub Licenses API fallback step;
//   --github-repo <name>   / auto-derived from --url when it's a github.com URL and these are omitted.
//   --reviewer-verdict <v>    'safe' | 'suspicious' — the security-reviewer subagent's
//                             verdict (TASK-122; the Orchestrator runs that subagent
//                             separately, over this same source dir, and passes its
//                             verdict back in on the next invocation). DEFAULT-DENY
//                             (TASK-140): --decision approve writes ONLY when this is
//                             exactly 'safe' — omitting --reviewer-verdict entirely, or
//                             passing 'suspicious' (or any other value), both refuse the
//                             write (status: blocked_security). There is no fail-open
//                             path: run the security-reviewer subagent and pass its
//                             verdict back in before approving, or the CLI will block.
//   --reviewer-reasoning <s>  free-text reasoning accompanying --reviewer-verdict.
//   --security-override       explicit human override allowing --decision approve to
//                             proceed despite a non-'safe' --reviewer-verdict (including
//                             a missing one); without it, that combination refuses the
//                             write (status: blocked_security).
//
// TASK-120 UAT-bounce gaps B + C:
//   B — the clone root is always forwarded to assimilateSkill as `repoRoot`
//       (distinct from `source`, the --subdir skill dir), so a LICENSE file
//       that lives at the repo root rather than inside the skill's own
//       subdir is still found by detectLicense's repoRoot fallback.
//   C — a real, minimal, UNAUTHENTICATED GitHub Licenses API fetcher is
//       wired here (bin glue only — kept out of unit/e2e tests, which stay
//       network-free via an injected stub).

import { execFileSync } from 'node:child_process';
import { request } from 'node:https';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { assimilateSkill } from '../src/assimilate.js';

const FLAGS_WITH_VALUE = new Set([
  '--url', '--resource-id', '--pack', '--subdir', '--origin', '--pin',
  '--decision', '--root', '--github-owner', '--github-repo',
  '--reviewer-verdict', '--reviewer-reasoning',
]);
// TASK-122: the only boolean (no-value) flag -- presence alone means true.
const BOOLEAN_FLAGS = new Set(['--security-override']);

/** Parse `--flag-name value` pairs (and bare boolean flags) into a camelCase-keyed object. */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const key = flag.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (BOOLEAN_FLAGS.has(flag)) {
      out[key] = true;
      continue;
    }
    if (!FLAGS_WITH_VALUE.has(flag)) throw new Error(`unknown flag: ${flag}`);
    const value = argv[++i];
    if (value === undefined) throw new Error(`flag ${flag} requires a value`);
    out[key] = value;
  }
  return out;
}

// Best-effort {owner, repo} extraction from an https or ssh github.com URL
// (github.com/owner/repo, .../owner/repo.git, git@github.com:owner/repo.git).
// A repo name that itself contains a literal '.' (rare) won't match here --
// use --github-owner/--github-repo explicitly for that case.
function parseGithubCoords(url) {
  const m = /github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?\/?$/i.exec(url || '');
  return m ? { owner: m[1], repo: m[2] } : null;
}

// Minimal unauthenticated GET https://api.github.com/repos/{owner}/{repo}/license.
// Matches detectLicense's injected fetchGithubLicense contract: resolves the
// parsed JSON body on 200, or null on any non-200/network/parse failure (a
// 404/private-repo/rate-limit response is "no signal", never fatal).
function fetchGithubLicense(owner, repo) {
  return new Promise((resolve) => {
    const req = request(
      {
        hostname: 'api.github.com',
        path: `/repos/${owner}/${repo}/license`,
        method: 'GET',
        headers: { 'User-Agent': 'hivemind-assimilate-skill', Accept: 'application/vnd.github+json' },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          resolve(null);
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.end();
  });
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

    const github = (args.githubOwner && args.githubRepo)
      ? { owner: args.githubOwner, repo: args.githubRepo }
      : parseGithubCoords(args.url);

    // TASK-122: --reviewer-verdict is how the Orchestrator hands this CLI the
    // security-reviewer subagent's verdict from a prior run (that subagent
    // itself is not spawned from here -- see src/assimilate.js's SECURITY
    // REVIEW BOUNDARY note).
    const reviewerVerdict = args.reviewerVerdict
      ? { verdict: args.reviewerVerdict, reasoning: args.reviewerReasoning || '' }
      : undefined;

    const result = await assimilateSkill({
      source: args.subdir ? join(cloneDir, args.subdir) : cloneDir,
      resourceId: args.resourceId,
      pack: args.pack,
      origin: args.origin || args.url,
      pin,
      repoRoot: cloneDir,
      decision: args.decision,
      root: args.root || process.cwd(),
      github: github || undefined,
      fetch: github ? fetchGithubLicense : undefined,
      reviewerVerdict,
      securityOverride: args.securityOverride === true,
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
