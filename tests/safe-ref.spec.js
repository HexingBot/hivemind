// tests/safe-ref.spec.js
// TASK-185 — safeRef (src/mcp-server.js) is the READ-boundary guard that nulls
// an unsafe `ref` before kb_graph_query hands it to an agent that is told
// (orchestrator-routing SKILL.md) to auto-follow it as a path. TASK-175 item 4
// introduced the guard; this ticket closes two gaps found in the 2026-08-02
// deep review:
//
//   1. The absolute-path / home-shorthand / scheme checks are `^`-anchored
//      and the guard did no trimming, so one leading space, tab, or an
//      embedded newline defeated it outright (verified by direct execution
//      of the committed regex).
//   2. The only spec exercising safeRef fed exactly three inputs — mutation-
//      confirmed (two independent review passes) that deleting `~` from the
//      character class, deleting `\` from it, or deleting the
//      `(?:^|[/\\])` mid-path prefix EACH left the whole suite green.
//
// TESTS-FIRST FAILURE SURFACE (AC1): every `it` in the "bypass forms" describe
// block below asserts safeRef(input) === null for a whitespace/newline/percent-
// encoded variant of an unsafe path. Today safeRef performs no trimming and the
// checks are `^`-anchored, so it returns each input UNCHANGED (not null) — the
// assertions fail with "expected null, received '<the still-unsafe string>'",
// the right-reason failure this AC requires (not an import/type error: safeRef
// is already exported as of this same ticket's infra step).

import { describe, it, expect } from 'vitest';
import { safeRef } from '../src/mcp-server.js';

describe('TASK-185 AC1/AC2 — safeRef blocks all six bypass forms named in the ticket', () => {
  it('leading-space absolute path is blocked, not returned unchanged', () => {
    expect(safeRef(' /etc/passwd')).toBeNull();
  });

  it('tab-prefixed absolute path is blocked', () => {
    expect(safeRef('\t/etc/passwd')).toBeNull();
  });

  it('whitespace-padded ~ home shorthand is blocked', () => {
    expect(safeRef('  ~/.ssh/id_rsa')).toBeNull();
  });

  it('leading-space UNC \\\\host\\share path is blocked (SMB credential-leak vector)', () => {
    expect(safeRef(' \\\\evil-host\\share\\payload')).toBeNull();
  });

  it('embedded-newline absolute path is blocked (a later line hides the real path)', () => {
    expect(safeRef('a\n/etc/passwd')).toBeNull();
  });

  it('percent-encoded traversal (%2e%2e) is blocked', () => {
    expect(safeRef('%2e%2e/x')).toBeNull();
  });
});

describe('TASK-185 AC2 — a normal repo-relative ref still passes through untouched', () => {
  it('an ordinary task ref is returned unchanged', () => {
    expect(safeRef('tasks/TASK-900.json')).toBe('tasks/TASK-900.json');
  });

  it('an ordinary decision ref is returned unchanged', () => {
    expect(safeRef('knowledge/decisions/x.md')).toBe('knowledge/decisions/x.md');
  });
});

// ---------------------------------------------------------------------------
// AC3 — every alternation in UNSAFE_REF_RE is individually locked. Each input
// below is deliberately UN-padded (no leading/trailing whitespace) so it can
// ONLY be caught by the specific alternation it targets — that is what makes
// each test break under its named mutation. Mutation drills (delete `~` from
// the character class, delete `\` from it, delete the `(?:^|[/\\])` mid-path
// prefix) were run by hand against these three inputs; see the hand-off for
// the captured red output of each.
// ---------------------------------------------------------------------------
describe('TASK-185 AC3 — mutation-locked alternations', () => {
  it('un-padded ~ shorthand is blocked (locks `~` in the leading character class)', () => {
    expect(safeRef('~/.ssh/id_rsa')).toBeNull();
  });

  it('un-padded UNC path is blocked (locks `\\` in the leading character class)', () => {
    expect(safeRef('\\\\host\\share')).toBeNull();
  });

  it('mid-path traversal not at string start is blocked (locks the (?:^|[/\\\\]) prefix)', () => {
    expect(safeRef('docs/../../etc/passwd')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TASK-193 AC1 — the TASK-185 reviewer executed the committed guard against
// adjacent forms and found these pass through UNCHANGED (not null), because
// UNSAFE_REF_RE only matches the literal token `%2e%2e` and requires `..` to
// be flanked by a path separator or string start/end. None of these is
// exploitable today (no consumer percent-decodes or naively strips `../`
// before resolving; refs are opened as literal repo-relative paths) — that is
// why TASK-185 closed this as LOW rather than blocking. This block is the
// tests-first failing spec: today safeRef(input) === input for every case
// below; the fix must make every one resolve to null.
// ---------------------------------------------------------------------------
describe('TASK-193 AC1 — percent-encoding / dot-stripper-bait residuals are blocked', () => {
  it('double-encoded traversal (%252e%252e) is blocked', () => {
    expect(safeRef('%252e%252e/x')).toBeNull();
  });

  it('literal .. with an encoded forward-slash separator is blocked', () => {
    expect(safeRef('..%2fx')).toBeNull();
  });

  it('literal .. with an encoded backslash separator is blocked', () => {
    expect(safeRef('..%5cx')).toBeNull();
  });

  it('double encoded-separator traversal is blocked', () => {
    expect(safeRef('..%2f..%2fetc%2fpasswd')).toBeNull();
  });

  it('mid-path .. with an encoded separator is blocked', () => {
    expect(safeRef('x%2f..%2fetc')).toBeNull();
  });

  it('naive ../-stripper bait (repeated dots before a doubled slash) is blocked', () => {
    expect(safeRef('....//etc/passwd')).toBeNull();
  });

  it('embedded percent-encoded null byte is blocked', () => {
    expect(safeRef('a%00/etc/passwd')).toBeNull();
  });
});

describe('TASK-193 AC6 — no false-negative regression against the live graph', () => {
  it('every ref currently stored in knowledge/graph/graph.json still passes through unchanged', async () => {
    const { readFile } = await import('node:fs/promises');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const raw = await readFile(join(__dirname, '..', 'knowledge', 'graph', 'graph.json'), 'utf8');
    const graph = JSON.parse(raw);
    const refs = (graph.nodes || []).map((n) => n.ref).filter((r) => typeof r === 'string');
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(safeRef(ref)).toBe(ref);
    }
  });
});
