// tests/knowledge-lookup.spec.js
// AC9 — Researcher subagent contract mandates KB lookup before web search.
// AC9 — Orchestrator updates last_seen_at on reuse.
// AC10 — knowledge/ is portable: drop into a blank project and the lookup still works.
//
// Maps research §H:
//   #20 researcher_contract_mentions_kb_lookup
//   #21 orchestrator_updates_last_seen_at_on_reuse
//   #22 knowledge_copy_works_in_blank_project

import { describe, it, expect, afterAll } from 'vitest';
import {
  readFileSync, existsSync, cpSync, readdirSync, writeFileSync, statSync,
} from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';

import { REPO_ROOT } from '../helpers/repoRoot.js';
import { PROD } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

describe('AC9 — researcher contract mandates KB lookup', () => {
  it('researcher_contract_mentions_kb_lookup', () => {
    const contractPath = join(REPO_ROOT, '.claude', 'agents', 'researcher.md');
    expect(existsSync(contractPath), 'researcher.md must exist').toBe(true);
    const text = readFileSync(contractPath, 'utf8');

    // The contract MUST tell the Researcher to consult knowledge/ before web search.
    expect(text).toMatch(/knowledge\//i);
    // Must contain a heading/section for the lookup procedure.
    expect(text).toMatch(/knowledge base lookup|kb lookup/i);
    // The output format addition: kb_hits and proposed_kb_entry.
    expect(text).toMatch(/kb_hits/);
    expect(text).toMatch(/proposed_kb_entry/);
    // Lookup must run BEFORE web search.
    expect(text).toMatch(/before.*(web ?search|websearch|webfetch)/i);
  });
});

describe('AC9 — last_seen_at update on KB reuse', () => {
  it('orchestrator_updates_last_seen_at_on_reuse', async () => {
    const { recordKbReuse } = await import(PROD.knowledge);

    // Stage: copy committed knowledge/ into a tmp workspace so we don't mutate the real KB.
    const tmpRepo = makeTmpDir('af-kb-reuse');
    cpSync(join(REPO_ROOT, 'knowledge'), join(tmpRepo, 'knowledge'), { recursive: true });

    const entryFiles = readdirSync(join(tmpRepo, 'knowledge', 'entries'))
      .filter((n) => n.endsWith('.md'));
    expect(entryFiles.length).toBeGreaterThan(0);
    const targetFile = join(tmpRepo, 'knowledge', 'entries', entryFiles[0]);

    const beforeRaw = readFileSync(targetFile, 'utf8');
    const beforeData = matter(beforeRaw).data;
    const beforeLastSeen = beforeData.last_seen_at;

    await new Promise((r) => setTimeout(r, 5));
    await recordKbReuse({
      repoRoot: tmpRepo,
      entryId: beforeData.id,
      at: '2026-05-25T09:00:00Z',
    });

    const afterRaw = readFileSync(targetFile, 'utf8');
    const afterData = matter(afterRaw).data;
    expect(afterData.last_seen_at).not.toBe(beforeLastSeen);
    expect(afterData.last_seen_at).toBe('2026-05-25T09:00:00Z');
    // Body preserved.
    expect(matter(afterRaw).content).toBe(matter(beforeRaw).content);
  });
});

describe('AC10 — knowledge/ is portable to a blank project', () => {
  it('knowledge_copy_works_in_blank_project', async () => {
    const { lookupKnowledge } = await import(PROD.knowledge);

    // GIVEN: a blank project root containing ONLY knowledge/ copied over.
    const blank = makeTmpDir('af-kb-blank');
    cpSync(join(REPO_ROOT, 'knowledge'), join(blank, 'knowledge'), { recursive: true });

    // Lookup procedure works against the copy.
    const result = await lookupKnowledge({
      repoRoot: blank,
      question: 'how do I do an atomic rename safely on Windows?',
    });
    expect(Array.isArray(result.kb_hits)).toBe(true);

    // All entries parse cleanly and frontmatter has no project-specific filesystem paths.
    const entries = readdirSync(join(blank, 'knowledge', 'entries'))
      .filter((n) => n.endsWith('.md'));
    expect(entries.length).toBeGreaterThan(0);
    for (const name of entries) {
      const raw = readFileSync(join(blank, 'knowledge', 'entries', name), 'utf8');
      const { content, data } = matter(raw);
      expect(data.id).toBeDefined();
      // Same M1 fix as in knowledge-files.spec.js: one `\\` in this literal
      // is one literal `\` in the regex, which matches a real Windows path.
      expect(content).not.toMatch(/[A-Z]:\\/);
      expect(content).not.toMatch(/\/Users\//);
      expect(content).not.toMatch(/\/home\//);
      expect(content).not.toMatch(/\\\\\?\\/);
    }
  });
});
