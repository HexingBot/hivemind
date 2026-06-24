#!/usr/bin/env node
// upstream-pr — Phase 6, dry-run: classify the commits ahead of `upstream/main` and print which
// are contributable back to lordiwa/agent-framework (ENGINE), which are hivemind-only (HIVEMIND),
// and which are MIXED (need a human split). This NEVER pushes — it only reports a plan; opening the
// PR is a deliberate human step (engine-only branch -> PR on the template), like engine-tools'
// upstream_push. Zero-dep.

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { contributionPlan } from '../src/upstream-classify.js';

function commitsAheadOfUpstream(range = 'upstream/main..HEAD') {
  const log = execFileSync('git', ['log', '--format=%H%x1f%s', range], { encoding: 'utf8' }).trim();
  if (!log) return [];
  return log.split('\n').map((line) => {
    const [sha, subject] = line.split('\x1f');
    const files = execFileSync('git', ['show', '--name-only', '--format=', sha], { encoding: 'utf8' })
      .split('\n').map((s) => s.trim()).filter(Boolean);
    return { sha: sha.slice(0, 9), subject, files };
  });
}

function main() {
  let plan;
  try {
    plan = contributionPlan(commitsAheadOfUpstream());
  } catch (err) {
    process.stderr.write(`[upstream-pr] could not read commits ahead of upstream/main: ${err.message}\n`);
    process.exit(2);
  }
  const line = (c) => `  ${c.sha} ${c.subject}`;
  process.stdout.write('Upstream contribution plan (dry-run — nothing is pushed)\n');
  process.stdout.write('=======================================================\n');
  process.stdout.write(`Contributable (ENGINE) — ${plan.contributable.length}:\n${plan.contributable.map(line).join('\n') || '  (none)'}\n\n`);
  process.stdout.write(`Hivemind-only (BLOCKED) — ${plan.blocked.length}:\n${plan.blocked.map(line).join('\n') || '  (none)'}\n\n`);
  process.stdout.write(`Needs human split (MIXED) — ${plan.needsSplit.length}:\n${plan.needsSplit.map(line).join('\n') || '  (none)'}\n\n`);
  process.stdout.write('Next: cherry-pick the ENGINE commits onto a branch off upstream/main and open a PR.\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
