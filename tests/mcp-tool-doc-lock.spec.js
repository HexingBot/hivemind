// tests/mcp-tool-doc-lock.spec.js
// TASK-208 — doc-drift sensor: derives the MCP tool list from createServer's
// REAL registrations (never a hardcoded copy — that would just relocate the
// drift TASK-168/TASK-204 both hit) and asserts every registered tool is
// documented, in both parity copies of all three mcp-server skill doc files.
//
// ROOT CAUSE THIS CLOSES (see the TASK-208 ticket): tests/mcp-server-skill.spec.js
// locks byte-PARITY between .claude/skills/mcp-server/ and skills/mcp-server/ —
// parity is the wrong invariant here, since it happily keeps both copies wrong
// together. Nothing derived the documented tool list from live registrations,
// so prose drifted arbitrarily far (TASK-168 added kb_graph_query, TASK-204
// added mcp_build_status; neither doc update landed) while every existing
// sensor stayed green. This spec is the missing derivation.
//
// TIER: fast (tests/*.spec.js) — no real disk I/O beyond reading already-
// on-disk committed doc files (same precedent as tests/graph-freshness.spec.js
// / tests/use-case-policy.spec.js) and an in-memory (no subprocess, no
// mkdtemp) MCP client/server round trip purely to call listTools() —
// createServer() only ever touches `repoRoot` inside a TOOL HANDLER, and this
// spec never calls one, so a fake non-existent repoRoot is safe to pass.
//
// AC2 — word-boundary, not substring (TASK-184 precedent: a bare substring
// check made "code" vacuously "documented" via "hardcoded"). isNameDocumented
// anchors on \b, which treats `_` as a word character (JS \w), so a partial
// match embedded in a longer identifier (e.g. "close_task" inside
// "preclose_task_helper") is correctly rejected — see the dedicated
// near-miss unit tests below.
//
// AC3 — non-vacuity: the "removed tool" red-run is proven two ways —
//   (1) permanently, via a synthetic-text unit test below (findUndocumentedTools
//       correctly flags a name stripped from a copy of REAL doc text, not a
//       fixture invented from scratch);
//   (2) empirically, for real: BEFORE the AC5 prose fixes in this same commit
//       landed, this exact live-doc assertion block failed against the
//       then-current (unedited) doc files, naming precisely the real drift —
//       `kb_graph_query, mcp_build_status` missing from both tool-contract.md
//       copies, and `append_comment, kb_graph_query, list_ready,
//       mcp_build_status` (plus `close_task` for SKILL.md) missing from the
//       other four locations — captured verbatim in the TASK-208 hand-off.
//       That is real red, from real (pre-fix) drift, not a staged one.
// The checked set itself is asserted non-empty and derived from a REAL
// listTools() call, not a fixture, in the "AC1/AC3" block below.
//
// AC4 — reverse direction (documented-but-not-registered) is asserted ONLY
// against tool-contract.md's structured table (both copies): it is the one
// doc with a closed, mechanically-parseable per-tool enumeration (one row per
// tool, first column always a backtick-wrapped tool name). SKILL.md and
// in-memory-test-harness.md are free-form prose/code narrative with no closed
// list to parse against without either hardcoding a candidate-token list
// (which relocates the exact drift this ticket exists to close) or accepting
// false positives against ordinary identifiers that share the naming shape
// (`repoRoot`, `CLAUDE_PROJECT_DIR`, ...). Forward coverage (every real tool
// must be literally named somewhere in the file) is enforced for all three
// files; reverse coverage is enforced only where it can be derived
// mechanically and unambiguously.
//
// FIX ROUND (post-APPROVE, same ticket) — the gating reviewer demonstrated
// that "named anywhere in the file" is too weak for tool-contract.md
// specifically: deleting a tool's TABLE ROW while its name stays present in
// the section heading / WILL-WON'T prose left `findUndocumentedTools` green
// — exactly the sub-defect this ticket exists to close (both kb_graph_query
// and mcp_build_status were missing table rows, not just prose mentions,
// before this ticket's first commit). tool-contract.md (both copies) now
// ALSO requires every real tool to have an actual table ROW
// (findToolsMissingTableRow, reusing parseToolContractTableNames — the same
// mechanism AC4's reverse check already used), proven red on exactly that
// scenario below. The two prose-only files stay on the anywhere-in-file
// check; they have no table to require a row in.
//
// FIX ROUND — tool COUNT is no longer asserted anywhere in the checked docs
// (or in src/mcp-server.js's top-of-file DESIGN comment): the reviewer
// showed that rewriting "ten tools total" -> "eight tools total" left this
// entire spec green, because every check here operates on NAMES, never on a
// numeral or an English number-word. Asserting a number-word derivation
// (`\b(seven|eight|nine|ten|eleven)\b`) was considered and rejected: a count
// is a fact that rots by construction on the next added/removed tool, and
// the docs already carry the full, itemized name list — a redundant total
// adds a second, unsensed place for the exact defect class this ticket
// exists to close to recur. The prose in all three doc files (and the
// src/mcp-server.js comment) was edited to drop every "N tools" phrasing
// instead.
//
// LOW (noted, not fixed) — (a) membership here counts a name in ANY
// context: a URL, an HTML comment, a stray "TODO: document kb_lookup" line
// would all satisfy isNameDocumented. The table-row check above closes this
// for tool-contract.md; the three prose-only legs (in-memory-test-harness.md,
// SKILL.md, and tool-contract.md's own prose outside the table) keep this
// gap. (b) conditional-registration blindness: this spec instantiates
// createServer with its DEFAULT options only, so a tool registered solely
// under some non-default option would never appear in listTools() and would
// never be doc-checked — a false green by construction. Nothing in
// createServer registers conditionally today, but this is a real limit of
// the instantiation approach, not a hypothetical one, and is recorded here
// rather than silently assumed away.

import {
  describe, it, expect, beforeAll, afterAll,
} from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createServer } from '../src/mcp-server.js';
import { REPO_ROOT } from './helpers/repoRoot.js';

// ---------------------------------------------------------------------------
// Pure predicate logic (AC1/AC2/AC4) — kept local to this spec; nothing else
// in the repo needs it (no second caller, so no separate src/ module per the
// minimalism ladder).
// ---------------------------------------------------------------------------

/** Word-boundary membership — `_` counts as \w, so this rejects a name
 * embedded inside a longer identifier (AC2). */
function isNameDocumented(name, text) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`).test(text);
}

/** Every real tool name not found (word-boundary) in `text`. */
function findUndocumentedTools(toolNames, text) {
  return toolNames.filter((name) => !isNameDocumented(name, text));
}

// tool-contract.md's table rows are always `| \`tool_name\` | ...` — this
// mechanically derives the DOCUMENTED set from the table structure itself,
// never from a hand-maintained list.
const TABLE_ROW_RE = /^\|\s*`([a-z][a-z0-9_]*)`/gm;
function parseToolContractTableNames(text) {
  return [...text.matchAll(TABLE_ROW_RE)].map((m) => m[1]);
}

/** Documented table names with no matching real registration (AC4). */
function findPhantomDocumentedTools(documentedNames, realToolNames) {
  const real = new Set(realToolNames);
  return documentedNames.filter((n) => !real.has(n));
}

/** Fix round (post-APPROVE) — real tool names with no matching TABLE ROW in
 * `text` (stricter than isNameDocumented/findUndocumentedTools, which is
 * satisfied by ANY mention, including a prose-only one). Reuses
 * parseToolContractTableNames, the same table-structure derivation AC4's
 * reverse check already uses. */
function findToolsMissingTableRow(toolNames, text) {
  const documented = new Set(parseToolContractTableNames(text));
  return toolNames.filter((name) => !documented.has(name));
}

// ---------------------------------------------------------------------------
// AC2 — near-miss rejection, in isolation (no doc file involved).
// ---------------------------------------------------------------------------

describe('AC2 — isNameDocumented uses word-boundary matching, not substring', () => {
  it('rejects a tool name embedded inside a longer identifier', () => {
    expect(isNameDocumented('close_task', 'call preclose_task_helper() first')).toBe(false);
    // TASK-184's exact motivating case, replayed here: "code" must not match
    // vacuously via "hardcoded".
    expect(isNameDocumented('code', 'a hardcoded value')).toBe(false);
  });

  it('accepts the same name when it appears as a real, bounded token', () => {
    expect(isNameDocumented('close_task', 'call close_task now')).toBe(true);
    expect(isNameDocumented('close_task', 'the `close_task` tool')).toBe(true);
    expect(isNameDocumented('code', 'read the code path')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC3 — non-vacuity, permanent regression lock via synthetic text derived
// from a REAL doc file (not an invented fixture).
// ---------------------------------------------------------------------------

describe('AC3 — findUndocumentedTools is non-vacuous: proven red on a removed tool', () => {
  it('flags exactly the tool name stripped out of a copy of real doc text', () => {
    const realExcerpt = readFileSync(
      join(REPO_ROOT, '.claude', 'skills', 'mcp-server', 'references', 'tool-contract.md'),
      'utf8',
    );
    // Simulate the TASK-168/TASK-204 drift mechanically: strip every
    // occurrence of a real, currently-documented tool token and assert the
    // checker catches its absence.
    const mutilated = realExcerpt.replace(/\bkb_lookup\b/g, 'REDACTED');
    expect(findUndocumentedTools(['kb_lookup', 'list_todos'], mutilated)).toEqual(['kb_lookup']);
  });

  it('returns empty against the real, unmutated text (sanity: the mutation above is what causes red)', () => {
    const realExcerpt = readFileSync(
      join(REPO_ROOT, '.claude', 'skills', 'mcp-server', 'references', 'tool-contract.md'),
      'utf8',
    );
    expect(findUndocumentedTools(['kb_lookup', 'list_todos'], realExcerpt)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC1 — derive the real tool list from createServer's actual registrations
// (never hardcoded), via the SDK's in-memory transport + listTools(). No
// disk I/O: createServer() only touches `repoRoot` inside a tool HANDLER,
// none of which this spec ever calls, so a non-existent repoRoot is safe.
// ---------------------------------------------------------------------------

let realToolNames;
let client;

beforeAll(async () => {
  const server = createServer({ repoRoot: '/nonexistent/task-208-doc-lock' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'task-208-doc-lock', version: '0.0.0' });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  const { tools } = await client.listTools();
  realToolNames = tools.map((t) => t.name).sort();
});

afterAll(async () => {
  if (client) await client.close();
});

describe('AC1/AC3 — the checked set is real and non-empty, not a fixture', () => {
  it('createServer currently registers a non-empty, real tool list', () => {
    expect(Array.isArray(realToolNames)).toBe(true);
    expect(realToolNames.length).toBeGreaterThan(0);
    expect(realToolNames).toContain('mcp_build_status');
  });
});

const DOC_FILES = [
  ['plugin-root tool-contract.md', join('skills', 'mcp-server', 'references', 'tool-contract.md')],
  ['dev-copy tool-contract.md', join('.claude', 'skills', 'mcp-server', 'references', 'tool-contract.md')],
  ['plugin-root in-memory-test-harness.md', join('skills', 'mcp-server', 'references', 'in-memory-test-harness.md')],
  ['dev-copy in-memory-test-harness.md', join('.claude', 'skills', 'mcp-server', 'references', 'in-memory-test-harness.md')],
  ['plugin-root SKILL.md', join('skills', 'mcp-server', 'SKILL.md')],
  ['dev-copy SKILL.md', join('.claude', 'skills', 'mcp-server', 'SKILL.md')],
];

describe('AC1/AC6 — every real registered tool is documented (word-boundary) in all six locations', () => {
  it.each(DOC_FILES)('%s names every registered tool', (_label, relPath) => {
    const text = readFileSync(join(REPO_ROOT, relPath), 'utf8');
    const missing = findUndocumentedTools(realToolNames, text);
    expect(missing, `${relPath} is missing: ${missing.join(', ')}`).toEqual([]);
  });
});

const TOOL_CONTRACT_FILES = [
  ['plugin-root', join('skills', 'mcp-server', 'references', 'tool-contract.md')],
  ['dev-copy', join('.claude', 'skills', 'mcp-server', 'references', 'tool-contract.md')],
];

// ---------------------------------------------------------------------------
// Fix round (post-APPROVE) — tool-contract.md forward coverage requires an
// actual table ROW, not just any mention anywhere in the file. Closes the
// exact hole the gating reviewer demonstrated: deleting a table row while
// the tool's name stays present in the section heading / WILL-WON'T prose
// used to leave findUndocumentedTools green.
// ---------------------------------------------------------------------------

describe('AC1 (fix round) — tool-contract.md has a table row, not just a mention, for every registered tool', () => {
  it.each(TOOL_CONTRACT_FILES)('%s table has a row for every registered tool', (_label, relPath) => {
    const text = readFileSync(join(REPO_ROOT, relPath), 'utf8');
    const missingRow = findToolsMissingTableRow(realToolNames, text);
    expect(missingRow, `${relPath} table is missing a row for: ${missingRow.join(', ')}`).toEqual([]);
  });

  it('is proven red on exactly the sub-defect the reviewer found: a deleted table row with the prose mention left intact', () => {
    const realText = readFileSync(
      join(REPO_ROOT, '.claude', 'skills', 'mcp-server', 'references', 'tool-contract.md'),
      'utf8',
    );
    // Delete ONLY the kb_graph_query table row; its prose mentions (section
    // heading, WILL/WON'T docstring, etc.) are untouched.
    const rowDeleted = realText.replace(/^\|\s*`kb_graph_query`.*\r?\n/m, '');
    expect(rowDeleted, 'sanity: the row-delete regex must actually have removed a line').not.toEqual(realText);
    // The OLD (weaker) check stays green — this is the hole the reviewer found.
    expect(
      findUndocumentedTools(['kb_graph_query'], rowDeleted),
      'sanity: anywhere-in-file must NOT catch a row-only deletion (that IS the hole)',
    ).toEqual([]);
    // The NEW (stricter) check catches it.
    expect(findToolsMissingTableRow(['kb_graph_query'], rowDeleted)).toEqual(['kb_graph_query']);
  });
});

describe('AC4 — reverse direction: tool-contract.md documents no phantom tool', () => {
  it.each(TOOL_CONTRACT_FILES)('%s table lists no tool that is not actually registered', (_label, relPath) => {
    const text = readFileSync(join(REPO_ROOT, relPath), 'utf8');
    const documented = parseToolContractTableNames(text);
    // Non-vacuity for the reverse direction too: the table must actually
    // parse to a non-empty set (a broken table-row regex, or an emptied
    // table, must not silently report "no phantom tools" by finding none to
    // check — Empty-result contract, CLAUDE.md).
    expect(documented.length).toBeGreaterThan(0);
    const phantom = findPhantomDocumentedTools(documented, realToolNames);
    expect(phantom, `${relPath} documents tool(s) not actually registered: ${phantom.join(', ')}`).toEqual([]);
  });

  it('parseToolContractTableNames is itself non-vacuous on a synthetic table', () => {
    const sample = [
      '| MCP tool | Args |',
      '|----------|------|',
      '| `list_todos` | `{}` |',
      '| `fake_tool` | `{}` |',
    ].join('\n');
    expect(parseToolContractTableNames(sample)).toEqual(['list_todos', 'fake_tool']);
  });
});
