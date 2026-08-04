#!/usr/bin/env node
// scripts/provision-worktree.mjs — TASK-198 defect 2 CLI entrypoint.
//
// Links a worktree's `node_modules` to the primary checkout's own, per the
// human decision recorded in src/worktree-provision.js's module doc comment.
// No automatic seam in this repo runs this at worktree-creation time (see
// that same doc comment) — invoke it as the FIRST action once a
// worktree-isolated spawn is known to exist, before relying on anything
// built or resolved inside it. See skills/orchestrator-routing/SKILL.md's
// "Provisioning requirements" subsection.
//
// Usage: node scripts/provision-worktree.mjs <worktreePath>
// Exits non-zero with a message on stderr on any failure (including the
// deliberate refusal to clobber a real, non-empty node_modules).

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { provisionWorktreeNodeModules } from '../src/worktree-provision.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const worktreePath = process.argv[2];
if (!worktreePath) {
  process.stderr.write('Usage: node scripts/provision-worktree.mjs <worktreePath>\n');
  process.exit(1);
}

try {
  const result = provisionWorktreeNodeModules({ worktreePath, primaryRoot: REPO_ROOT });
  process.stdout.write(`provision-worktree: ${result.action} — ${result.worktreeNodeModules} -> ${result.primaryNodeModules}\n`);
  process.exit(0);
} catch (err) {
  process.stderr.write(`provision-worktree: FAILED — ${err.code ? `${err.code}: ` : ''}${err.message}\n`);
  process.exit(1);
}
