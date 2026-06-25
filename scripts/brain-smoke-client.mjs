#!/usr/bin/env node
// brain-smoke-client.mjs - exercise the hivemind brain-client over the live MCP brain, then prove
// graceful grep-fallback. Run by scripts/brain-smoke.sh. The fallback half needs no infra and is
// the success criterion (exit 0 iff an offline read degrades to the grep KB).

import { join } from 'node:path';
import { createBrainClient, createStdioConnect } from '../src/brain-client.js';

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const topic = process.argv[2] || 'smoke';
const launcher = join(root, 'bin', 'brain-launch.js');

// --- live brain (best-effort): connect via the launcher, probe health + a read ---
console.log('  -- live brain (best-effort) --');
try {
  const connect = createStdioConnect({ command: 'node', args: [launcher], env: process.env });
  const brain = createBrainClient({ repoRoot: root, connect });
  brain.subscribe((e) => console.log(`     event: ${e.type}${e.op ? ' ' + e.op : ''}`));
  const health = await brain.health();
  console.log('     kb_health:', JSON.stringify(health));
  const res = await brain.search({ topic, question: 'what does React Query cache?' });
  console.log(`     search source=${res.source} hits=${(res.hits || []).length}`);
  await brain.close();
} catch (err) {
  console.log('     live brain unavailable:', err.message, '(expected without Docker/Voyage)');
}

// --- graceful fallback (always): a brain that cannot connect must degrade to the grep KB ---
console.log('  -- graceful fallback (required) --');
const dead = createBrainClient({
  repoRoot: root,
  connect: async () => { throw new Error('brain offline'); },
});
const f = await dead.search({ topic, question: 'windows atomic rename' });
console.log(`     offline search source=${f.source} (expect "grep")`);
process.exit(f.source === 'grep' ? 0 : 1);
