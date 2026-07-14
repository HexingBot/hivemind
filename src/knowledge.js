// src/knowledge.js
// Five responsibilities:
//   (1) validateEntry(entryPath)         — schema-validate a single entry file
//   (2) lookupKnowledge({ repoRoot, question })
//                                        — deterministic three-pass lookup per research §F
//                                          (scans ONLY knowledge/entries/ — knowledge/proposed/
//                                          drafts are excluded by construction, TASK-105 AC3)
//   (3) recordKbReuse({ repoRoot, entryId, at })
//                                        — atomic update of last_seen_at, body preserved
//   (4) writeKnowledgeEntry({ repoRoot, entry, draft, overwrite })
//                                        — TASK-105 AC1: schema-validated, atomic KB write path.
//                                          draft (default true) writes knowledge/proposed/<id>.md
//                                          (unvetted); draft: false writes knowledge/entries/<id>.md
//                                          (vetted). Mirrors the store's validate-before-write
//                                          pattern (task-store.js / knowledge-graph.js): the schema
//                                          check runs BEFORE any disk mutation. TASK-111 AC1: rejects
//                                          an existing target id with E_KB_EXISTS unless the caller
//                                          opts in with { overwrite: true }.
//   (5) listDraftEntries({ repoRoot })   — enumerate knowledge/proposed/ (Gate 5's draftEntryCount
//                                          input, see src/drive-loop.js's consolidationGate)
//   (6) promoteDraftEntry({ repoRoot, id })
//                                        — TASK-111 AC2: one-call promotion — validate + write to
//                                          knowledge/entries/ + unlink the knowledge/proposed/ copy,
//                                          write-then-unlink ordered so a crash mid-promotion leaves
//                                          at worst a harmless duplicate, never a lost draft.

import {
  readFileSync, readdirSync, existsSync, statSync, mkdirSync, unlinkSync,
} from 'node:fs';
import { join } from 'node:path';

import matter from 'gray-matter';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

import { atomicWriteFile } from './atomic-write.js';

const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'to', 'for', 'in', 'on', 'with', 'and', 'or',
  'is', 'are', 'be', 'as', 'at', 'by', 'it', 'this', 'that', 'these',
  'those', 'do', 'does', 'how', 'what', 'when', 'where', 'why', 'can',
  'should', 'would', 'could', 'i', 'you', 'we', 'they',
]);

/* -------------------------------------------------------------------------- */
/*                                validateEntry                               */
/* -------------------------------------------------------------------------- */

/**
 * Schema-validate a single knowledge entry file's frontmatter.
 *
 * @param {{ repoRoot: string, entryPath: string }} args
 * @returns {{ valid: boolean, errors: any[]|null, data: object }}
 */
export function validateEntry({ repoRoot, entryPath }) {
  const schemaPath = join(repoRoot, 'knowledge', 'schema.json');
  if (!existsSync(schemaPath)) {
    throw makeErr('E_KB_SCHEMA_MISSING', `knowledge/schema.json not found at ${schemaPath}`);
  }
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const compiled = ajv.compile(schema);

  const raw = readFileSync(entryPath, 'utf8');
  const { data } = matter(raw);
  const ok = compiled(data);
  return { valid: ok, errors: ok ? null : compiled.errors, data };
}

/* -------------------------------------------------------------------------- */
/*                              lookupKnowledge                               */
/* -------------------------------------------------------------------------- */

/**
 * Deterministic KB lookup per research §F.
 *   1. Tokenize the question (lowercase, drop stopwords, keep tokens ≥ 3 chars).
 *   2. Three-pass scan over knowledge/entries/*.md:
 *        - tag matches      → weight 3
 *        - symptom matches  → weight 2
 *        - problem/body     → weight 1
 *   3. Rank by score; tie-break by id ascending (TASK-113 b: deterministic
 *      and independent of last_seen_at, which recordKbReuse — called on
 *      every hit this same lookup returns — mutates; a recency tie-break
 *      would make the top-3 CUT self-reinforcing across repeated lookups).
 *   4. Return the top-3 candidate hits as { id, score, used: false }.
 *      (The Researcher decides `used` on the way back; the Orchestrator
 *       then calls recordKbReuse on the entry that answered the question.)
 *
 * @param {{ repoRoot: string, question: string }} args
 * @returns {Promise<{ kb_hits: Array<{ id: string, score: number, used: boolean }> }>}
 */
export async function lookupKnowledge({ repoRoot, question }) {
  if (!repoRoot) throw makeErr('E_KB_ARGS', 'lookupKnowledge: repoRoot is required');
  if (typeof question !== 'string') {
    throw makeErr('E_KB_ARGS', 'lookupKnowledge: question must be a string');
  }
  const entriesDir = join(repoRoot, 'knowledge', 'entries');
  if (!existsSync(entriesDir)) {
    return { kb_hits: [] };
  }

  const tokens = tokenize(question);
  if (tokens.length === 0) {
    return { kb_hits: [] };
  }

  const candidates = [];
  for (const filename of readdirSync(entriesDir)) {
    if (!filename.endsWith('.md')) continue;
    const path = join(entriesDir, filename);
    const raw = readFileSync(path, 'utf8');
    const parsed = matter(raw);
    const data = parsed.data || {};
    const id = data.id || filename.replace(/\.md$/, '');

    const tagTokens = new Set(
      (data.tags || [])
        .flatMap((t) => tokenize(String(t)))
    );
    const symptomTokens = new Set(
      (data.symptoms || [])
        .flatMap((s) => tokenize(String(s)))
    );
    const bodyTokens = new Set([
      ...tokenize(String(data.problem || '')),
      ...tokenize(parsed.content || ''),
    ]);

    let score = 0;
    let tagHits = 0;
    let symptomHits = 0;
    let bodyHits = 0;
    for (const t of tokens) {
      if (tagTokens.has(t)) tagHits++;
      if (symptomTokens.has(t)) symptomHits++;
      if (bodyTokens.has(t)) bodyHits++;
    }
    score = tagHits * 3 + symptomHits * 2 + bodyHits * 1;

    if (score > 0) {
      candidates.push({ id, score });
    }
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // TASK-113(b): tie-break by id ascending — deterministic and immune to
    // the last_seen_at bump this same call's caller (kb_lookup) performs on
    // every returned hit. A recency tie-break here would make the top-3 CUT
    // (not just its final order) self-reinforcing: whichever entries won a
    // prior tied lookup get their last_seen_at bumped, biasing them to win
    // the next identically-scored lookup too. Matches kb_lookup's own
    // score-desc/id-asc re-sort (src/mcp-server.js, TASK-106) so there is a
    // single tie-break rule, not two that could disagree.
    return a.id.localeCompare(b.id);
  });

  return {
    kb_hits: candidates.slice(0, 3).map((c) => ({
      id: c.id,
      score: c.score,
      used: false,
    })),
  };
}

/**
 * Lowercase, split on whitespace and punctuation, drop English stopwords,
 * keep tokens of length >= 3. Deterministic given a fixed STOPWORDS set.
 */
export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/* -------------------------------------------------------------------------- */
/*                                recordKbReuse                               */
/* -------------------------------------------------------------------------- */

/**
 * Update the `last_seen_at` field of a knowledge entry, preserving the body
 * byte-for-byte. Uses the atomic temp+rename helper so a concurrent reader
 * never observes a partial write.
 *
 * @param {{ repoRoot: string, entryId: string, at?: string }} args
 */
export async function recordKbReuse({ repoRoot, entryId, at }) {
  if (!repoRoot) throw makeErr('E_KB_ARGS', 'recordKbReuse: repoRoot is required');
  if (!entryId) throw makeErr('E_KB_ARGS', 'recordKbReuse: entryId is required');

  const entryPath = join(repoRoot, 'knowledge', 'entries', `${entryId}.md`);
  if (!existsSync(entryPath)) {
    throw makeErr('E_KB_NOT_FOUND', `recordKbReuse: entry not found at ${entryPath}`);
  }

  const raw = readFileSync(entryPath, 'utf8');
  const parsed = matter(raw);
  const newData = { ...parsed.data, last_seen_at: at || new Date().toISOString() };
  const rebuilt = matter.stringify(parsed.content, newData);
  await atomicWriteFile(entryPath, rebuilt);
}

/* -------------------------------------------------------------------------- */
/*                              writeKnowledgeEntry                           */
/* -------------------------------------------------------------------------- */

/**
 * Schema-validated, atomic KB entry write (TASK-105 AC1) — the write-side
 * counterpart to validateEntry/lookupKnowledge. Validates `entry` against
 * knowledge/schema.json BEFORE any disk mutation (mirrors task-store.js /
 * knowledge-graph.js's validate-before-write convention); on failure, throws
 * and touches nothing on disk — not even the target directory.
 *
 * `entry` carries the same frontmatter fields as a vetted entry (id, problem,
 * symptoms, solution, tags, projects, created_at, last_seen_at, and the
 * optional source_urls/supersedes/superseded_by/source_tier), plus an
 * optional `body` string (the markdown after the frontmatter fence — NOT a
 * schema field, stripped before validation).
 *
 * `draft` (default true) selects the target directory: true writes
 * `knowledge/proposed/<id>.md` (unvetted — excluded entirely from
 * lookupKnowledge, which only ever scans knowledge/entries/); false writes
 * `knowledge/entries/<id>.md` (vetted). Prefer `promoteDraftEntry({ repoRoot,
 * id })` to promote a draft — it wraps this call with draft: false plus the
 * unlink of the knowledge/proposed/ copy as one atomic-ish, crash-safe step;
 * see knowledge/schema.md's "Draft entries" section for the full contract.
 *
 * TASK-111 AC1: an existing file at the target path is rejected with a typed
 * E_KB_EXISTS error by default — a repeated draft id would otherwise
 * silently clobber an unpromoted draft, and draft: false would otherwise
 * silently clobber an already-vetted entry. Pass `{ overwrite: true }` to
 * opt in to replacing the existing file.
 *
 * @param {{ repoRoot: string, entry: object, draft?: boolean, overwrite?: boolean }} args
 * @returns {Promise<{ id: string, path: string, draft: boolean }>}
 */
export async function writeKnowledgeEntry({
  repoRoot, entry, draft = true, overwrite = false,
}) {
  if (!repoRoot) throw makeErr('E_KB_ARGS', 'writeKnowledgeEntry: repoRoot is required');
  if (!entry || typeof entry !== 'object') {
    throw makeErr('E_KB_ARGS', 'writeKnowledgeEntry: entry object is required');
  }
  if (!entry.id || typeof entry.id !== 'string') {
    throw makeErr('E_KB_ARGS', 'writeKnowledgeEntry: entry.id is required');
  }

  const { body, ...frontmatter } = entry;

  const schemaPath = join(repoRoot, 'knowledge', 'schema.json');
  if (!existsSync(schemaPath)) {
    throw makeErr('E_KB_SCHEMA_MISSING', `knowledge/schema.json not found at ${schemaPath}`);
  }
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const compiled = ajv.compile(schema);
  const ok = compiled(frontmatter);
  if (!ok) {
    const details = (compiled.errors || [])
      .map((e) => `${e.instancePath || '/'} ${e.message}`)
      .join('; ');
    throw makeErr(
      'E_KB_INVALID_ENTRY',
      `writeKnowledgeEntry: entry failed schema validation: ${details}`,
    );
  }

  const targetDir = join(repoRoot, 'knowledge', draft ? 'proposed' : 'entries');
  const targetPath = join(targetDir, `${entry.id}.md`);

  // TASK-111 AC1: existence check runs AFTER schema validation (validation
  // failures never touch disk, per the comment below) but BEFORE any write —
  // a silent clobber of an unpromoted draft or an already-vetted entry is
  // exactly the MEDIUM-1 gap this guard closes.
  if (!overwrite && existsSync(targetPath)) {
    throw makeErr(
      'E_KB_EXISTS',
      `writeKnowledgeEntry: ${targetPath} already exists; pass { overwrite: true } to replace it`,
    );
  }

  const rendered = matter.stringify(body || '', frontmatter);

  // Directory creation happens AFTER validation passes — an invalid entry
  // never even creates knowledge/proposed/ (self-bootstrap on success only).
  mkdirSync(targetDir, { recursive: true });
  await atomicWriteFile(targetPath, rendered);

  return { id: entry.id, path: targetPath, draft };
}

/* -------------------------------------------------------------------------- */
/*                               listDraftEntries                             */
/* -------------------------------------------------------------------------- */

/**
 * Enumerate draft (unvetted) entries under knowledge/proposed/. Used to feed
 * `draftEntryCount` into `consolidationGate` (src/drive-loop.js) so Gate 5
 * surfaces pending drafts even when auto_consolidate lifts the ticket-count
 * pause. Returns [] when the directory does not exist — never throws.
 *
 * @param {{ repoRoot: string }} args
 * @returns {Array<{ id: string, path: string }>}
 */
export function listDraftEntries({ repoRoot }) {
  const dir = join(repoRoot, 'knowledge', 'proposed');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => ({ id: name.replace(/\.md$/, ''), path: join(dir, name) }));
}

/* -------------------------------------------------------------------------- */
/*                              promoteDraftEntry                             */
/* -------------------------------------------------------------------------- */

/**
 * Promote a draft (TASK-111 AC2, MEDIUM-2 follow-up): one call replaces the
 * previous two manual, non-atomic steps (re-write with draft: false, then
 * hand-delete the knowledge/proposed/ copy via a raw fs mutation outside any
 * validated path).
 *
 * Reads knowledge/proposed/<id>.md, then calls writeKnowledgeEntry with the
 * same frontmatter + body and draft: false — this reuses AC1's existence
 * guard, so an already-vetted collision (an entries/<id>.md that already
 * exists) throws E_KB_EXISTS with NO write and NO unlink. Only once that
 * write succeeds is the knowledge/proposed/ copy unlinked. This
 * write-then-unlink order means a crash between the two steps leaves at
 * worst a harmless duplicate (the entry exists in both directories) —
 * never a lost draft.
 *
 * TASK-113(d): rejects with a typed E_KB_DRAFT_ID_MISMATCH BEFORE any write
 * when the draft's own frontmatter `id` disagrees with the `id` argument (a
 * hand-edited draft) — otherwise the write would silently land under
 * `entries/<frontmatter-id>.md` while unlinking `proposed/<id argument>.md`,
 * returning an internally inconsistent `{ id, path }`.
 *
 * TASK-113(e): if `unlink` throws AFTER writeKnowledgeEntry has already
 * landed durably (the AV-handle class documented in the
 * windows-atomic-rename-not-truly-atomic KB entry — an antivirus scan can
 * briefly hold a handle open on the just-closed proposed/ file), the
 * rejection states that the promotion LANDED and names the surviving
 * proposed/ copy, instead of surfacing the raw unlink error with no context
 * — a caller must be able to tell this apart from a promotion that never
 * happened (e.g. the E_KB_EXISTS case above).
 *
 * @param {{ repoRoot: string, id: string, unlink?: (path: string) => void }} args
 *   `unlink` defaults to `node:fs`'s `unlinkSync`; injectable for tests that
 *   need to simulate an unlink failure deterministically.
 * @returns {Promise<{ id: string, path: string }>}
 */
export async function promoteDraftEntry({ repoRoot, id, unlink = unlinkSync }) {
  if (!repoRoot) throw makeErr('E_KB_ARGS', 'promoteDraftEntry: repoRoot is required');
  if (!id) throw makeErr('E_KB_ARGS', 'promoteDraftEntry: id is required');

  const draftPath = join(repoRoot, 'knowledge', 'proposed', `${id}.md`);
  if (!existsSync(draftPath)) {
    throw makeErr('E_KB_DRAFT_NOT_FOUND', `promoteDraftEntry: no draft found at ${draftPath}`);
  }

  const raw = readFileSync(draftPath, 'utf8');
  const parsed = matter(raw);

  // TASK-113(d): guard BEFORE any write. A missing frontmatter id is left to
  // writeKnowledgeEntry's existing "entry.id is required" check below; only a
  // PRESENT, DIFFERING id is this guard's concern.
  if (parsed.data && parsed.data.id !== undefined && parsed.data.id !== id) {
    throw makeErr(
      'E_KB_DRAFT_ID_MISMATCH',
      `promoteDraftEntry: draft at ${draftPath} has frontmatter id "${parsed.data.id}" `
        + `which does not match the requested id "${id}"`,
    );
  }

  const entry = { ...parsed.data, body: parsed.content };

  const result = await writeKnowledgeEntry({ repoRoot, entry, draft: false });

  try {
    unlink(draftPath);
  } catch (err) {
    throw makeErr(
      'E_KB_PROMOTE_UNLINK_FAILED',
      `promoteDraftEntry: entry "${id}" was already promoted to ${result.path} — the `
        + `promotion landed — but removing the leftover draft at ${draftPath} failed `
        + `(${err.message}). Delete ${draftPath} manually, or retry: a future call will `
        + 'hit E_KB_EXISTS (the promotion already happened), not a fresh promotion.',
    );
  }

  return { id, path: result.path };
}

/* -------------------------------------------------------------------------- */
/*                                  helpers                                   */
/* -------------------------------------------------------------------------- */

function makeErr(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}
