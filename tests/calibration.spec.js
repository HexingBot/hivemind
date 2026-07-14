import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  validateMarkers,
  validateMarkerForwarding,
  validateTiers,
  extractTier,
  isMandatedTierSurface,
  isExemptTierSurface,
  isMarkerVocabularyLine,
  partition,
  renderViolations,
} from '../src/calibration.js';
import { REPO_ROOT } from './helpers/repoRoot.js';

describe('validateMarkers', () => {
  it('flags uncalibrated [INFERRED]', () => {
    const v = validateMarkers('f.md', 'The API caches responses [INFERRED].');
    expect(v).toHaveLength(1);
    expect(v[0].severity).toBe('FLAG');
    expect(v[0].rule).toMatch(/uncalibrated/);
  });

  it('does NOT flag calibrated [INFERRED:strong] / [INFERRED:weak]', () => {
    expect(validateMarkers('f.md', 'x [INFERRED:strong]\ny [INFERRED:weak]')).toEqual([]);
  });

  it('flags an unmarked "confirmed/decided" list claim', () => {
    const v = validateMarkers('f.md', '- The retry limit was confirmed to be 3.');
    expect(v).toHaveLength(1);
    expect(v[0].rule).toMatch(/no marker/);
  });

  it('does not flag a "confirmed" claim that carries a marker', () => {
    expect(validateMarkers('f.md', '- The retry limit was confirmed to be 3. [EXPLICIT]')).toEqual([]);
  });

  // (R3/AC4) The old G3 check pre-filtered on a literal, case-sensitive
  // `line.includes('confirmed')` before running the case-insensitive claim-language
  // regex — making 'decided'/'resolved'/'proven' and any capitalized form dead code.
  // These previously-dead words must now trigger G3 (red-first for each).
  it('flags an unmarked "decided" list claim (previously dead — no "confirmed" substring)', () => {
    const v = validateMarkers('f.md', '- We decided to hard-code the retry limit at 3.');
    expect(v).toHaveLength(1);
    expect(v[0].rule).toMatch(/no marker/);
  });

  it('flags an unmarked "resolved" list claim (previously dead)', () => {
    const v = validateMarkers('f.md', '- The race condition was resolved by adding a lock.');
    expect(v).toHaveLength(1);
  });

  it('flags an unmarked "proven" list claim (previously dead)', () => {
    const v = validateMarkers('f.md', '- The cache invalidation bug was proven to be the root cause.');
    expect(v).toHaveLength(1);
  });

  it('flags a capitalized "Confirmed"/"Decided" claim (previously dead — case-sensitive substring check)', () => {
    expect(validateMarkers('f.md', '- Confirmed the retry limit is 3.')).toHaveLength(1);
    expect(validateMarkers('f.md', '- Decided to hard-code the retry limit.')).toHaveLength(1);
  });
});

describe('validateMarkerForwarding (assumption laundering — BLOCKER)', () => {
  const source = 'The rate limit is probably 60 rpm [ASSUMED]\nUsers may prefer dark mode [INFERRED:weak]';

  it('BLOCKS a weak source claim that lost its marker downstream', () => {
    const derived = '- The rate limit is probably 60 rpm and we depend on it.';
    const v = validateMarkerForwarding(source, derived, 'context/TECH.md', 'tasks/TASK-1.json');
    expect(v).toHaveLength(1);
    expect(v[0].severity).toBe('BLOCKER');
    expect(v[0].rule).toMatch(/marker dropped/);
    expect(v[0].file).toBe('tasks/TASK-1.json');
  });

  it('passes when the marker is preserved downstream', () => {
    const derived = '- The rate limit is probably 60 rpm [ASSUMED] — do not hard-code.';
    expect(validateMarkerForwarding(source, derived, 's', 'd')).toEqual([]);
  });

  it('passes when the downstream does not restate the weak claim at all', () => {
    expect(validateMarkerForwarding(source, 'totally unrelated text', 's', 'd')).toEqual([]);
  });
});

describe('extractTier + validateTiers (ceiling)', () => {
  it('extracts the tier from frontmatter', () => {
    expect(extractTier('---\nsource_tier: T3\n---')).toBe('T3');
    expect(extractTier('no tier here')).toBeNull();
  });

  it('extracts the JSON-form tier used by tasks/*.json (AC3)', () => {
    expect(extractTier('{\n  "key": "TASK-1",\n  "source_tier": "T1"\n}')).toBe('T1');
    expect(extractTier('{"source_tier":"T2","status":"todo"}')).toBe('T2');
    // the schema's own property *definition* (an object, not a value) must not false-match
    expect(extractTier('{"properties": {"source_tier": {"type": "string"}}}')).toBeNull();
  });

  it('produces NO finding for a missing tier on a non-mandated surface (AC1 design constraint)', () => {
    // README.md, commands/*.md, schema docs, etc. never carry source_tier and never will —
    // a BLOCKER (or even a FLAG) here would make the gate unusable.
    expect(validateTiers('README.md', 'no frontmatter')).toEqual([]);
    expect(validateTiers('commands/loop.md', 'no frontmatter')).toEqual([]);
  });

  it('BLOCKS a missing source_tier on a mandated surface — knowledge entry (AC1, red-first)', () => {
    const v = validateTiers('knowledge/entries/some-lesson.md', '---\nid: some-lesson\n---\nbody');
    expect(v).toHaveLength(1);
    expect(v[0].severity).toBe('BLOCKER');
    expect(v[0].rule).toMatch(/mandated surface/);
  });

  it('BLOCKS a missing source_tier on a mandated surface — an active ticket JSON (AC1, red-first)', () => {
    const v = validateTiers('tasks/TASK-999.json', '{\n  "key": "TASK-999",\n  "status": "todo"\n}');
    expect(v).toHaveLength(1);
    expect(v[0].severity).toBe('BLOCKER');
  });

  it('EXEMPTS a closed ticket (status: done) from the mandate — grandfathered, no finding (AC1/AC5 exemption)', () => {
    const v = validateTiers('tasks/TASK-005.json', '{\n  "key": "TASK-005",\n  "status": "done"\n}');
    expect(v).toEqual([]);
  });

  // (M1, review follow-up) extractTier/isExemptTierSurface used content-wide regexes on
  // *.json mandated surfaces. Note: properly-escaped valid JSON can never contain an
  // UNESCAPED `"status": "done"` or `"source_tier": "T1"` substring except as the real
  // top-level field — JSON.stringify backslash-escapes any embedded quote, which already
  // breaks a naive regex match (verified: a JSON.stringify'd description quoting the
  // phrase does NOT match the old regex). The actual exploitable shape is malformed/
  // corrupted content (a bad write, truncation, manual edit) that is NOT valid JSON but
  // still contains the literal spoof substring — the old regex-only approach still
  // "matched" it and produced a false exemption / false tier. Fixed by JSON.parse'ing and
  // reading ONLY the top-level status/source_tier fields of the parsed object; a parse
  // failure fails closed (not exempt, no tier) rather than falling back to text-scanning.
  it('does NOT let a spoofed "status": "done" substring in malformed (unparseable) content falsely exempt a ticket (M1)', () => {
    // Not valid JSON (stray leading text + no closing brace) but contains the literal,
    // unescaped substring a content-wide regex would mistake for the real status field.
    const spoofed = 'garbage before { "key": "TASK-503", "status": "done"';
    expect(isExemptTierSurface('tasks/TASK-503.json', spoofed)).toBe(false);
    const v = validateTiers('tasks/TASK-503.json', spoofed);
    expect(v).toHaveLength(1);
    expect(v[0].severity).toBe('BLOCKER');
  });

  it('does NOT let a spoofed "source_tier": "T1" substring in malformed (unparseable) content supply a tier (M1)', () => {
    const spoofed = 'garbage before { "key": "TASK-504", "source_tier": "T1"';
    expect(extractTier(spoofed)).toBeNull();
  });

  // (M2, review follow-up) A non-mandated "context" doc carrying epistemic markers but no
  // source_tier made the tier-ceiling rules unreachable on exactly the surface reviewer.md
  // names. Fixed: tier-missing + any marker present -> FLAG. Tier-missing + marker-free
  // stays silent, so AC5's "no uniform FLAG wall" guarantee holds.
  it('FLAGS a non-mandated context doc carrying an epistemic marker but no source_tier (M2)', () => {
    const v = validateTiers('context/TECH.md', 'The API caches responses [INFERRED:weak], not yet confirmed.');
    expect(v).toHaveLength(1);
    expect(v[0].severity).toBe('FLAG');
  });

  it('stays silent on a marker-free non-mandated doc — no revived FLAG wall (M2)', () => {
    expect(validateTiers('README.md', 'Just prose, no markers, no frontmatter.')).toEqual([]);
  });

  it('BLOCKS [EXPLICIT] in a T3 file', () => {
    const v = validateTiers('f.md', 'source_tier: T3\n\nThe value is 5 [EXPLICIT]');
    expect(v.some((x) => x.severity === 'BLOCKER' && /T3 but uses \[EXPLICIT\]/.test(x.rule))).toBe(true);
  });

  it('BLOCKS any [INFERRED] in a T4 file', () => {
    const v = validateTiers('f.md', 'source_tier: T4\n\nLikely true [INFERRED:strong]');
    expect(v.some((x) => x.severity === 'BLOCKER' && /T4/.test(x.rule))).toBe(true);
  });

  it('allows [EXPLICIT] in a T1/T2 file', () => {
    expect(validateTiers('f.md', 'source_tier: T1\n\nReturns 200 [EXPLICIT]')).toEqual([]);
    expect(validateTiers('f.md', 'source_tier: T2\n\nReturns 200 [EXPLICIT]')).toEqual([]);
  });

  it('rejects a whole TX file as a single BLOCKER', () => {
    const v = validateTiers('f.md', 'source_tier: TX\n\nanything [EXPLICIT]');
    expect(v).toHaveLength(1);
    expect(v[0].severity).toBe('BLOCKER');
    expect(v[0].rule).toMatch(/rejected/);
  });
});

describe('helpers', () => {
  it('partition splits blockers and flags', () => {
    const v = [...validateTiers('f.md', 'source_tier: T3\n\nx [EXPLICIT]'), ...validateMarkers('f.md', 'y [INFERRED]')];
    const { blockers, flags } = partition(v);
    expect(blockers).toHaveLength(1);
    expect(flags).toHaveLength(1);
  });

  it('renderViolations is friendly when empty', () => {
    expect(renderViolations([])).toMatch(/No calibration violations/);
  });
});

describe('isMandatedTierSurface / isExemptTierSurface (AC1 mandate scoping)', () => {
  it('mandates knowledge entries and ticket JSONs only', () => {
    expect(isMandatedTierSurface('knowledge/entries/foo.md')).toBe(true);
    expect(isMandatedTierSurface('tasks/TASK-042.json')).toBe(true);
    // backslash paths (Windows) must be handled the same as forward-slash
    expect(isMandatedTierSurface('knowledge\\entries\\foo.md')).toBe(true);
  });

  it('does NOT mandate unrelated repo surfaces (the design constraint)', () => {
    expect(isMandatedTierSurface('README.md')).toBe(false);
    expect(isMandatedTierSurface('commands/loop.md')).toBe(false);
    expect(isMandatedTierSurface('knowledge/README.md')).toBe(false);
    expect(isMandatedTierSurface('knowledge/schema.json')).toBe(false);
    expect(isMandatedTierSurface('tasks/schema.json')).toBe(false);
    expect(isMandatedTierSurface('tasks/index.json')).toBe(false);
  });

  it('exempts only closed (status: done) ticket JSONs, with rationale traveling in the code comment', () => {
    expect(isExemptTierSurface('tasks/TASK-005.json', '{"status": "done"}')).toBe(true);
    expect(isExemptTierSurface('tasks/TASK-005.json', '{"status": "todo"}')).toBe(false);
    // knowledge entries carry no exemption — they are living docs, always re-editable
    expect(isExemptTierSurface('knowledge/entries/foo.md', '---\nstatus: done\n---')).toBe(false);
  });
});

describe('AC2 — knowledge/schema.json permits source_tier (currently additionalProperties:false forbids it)', () => {
  it('schema declares a source_tier enum property', () => {
    const schema = JSON.parse(readFileSync(join(REPO_ROOT, 'knowledge', 'schema.json'), 'utf8'));
    expect(schema.properties.source_tier, 'knowledge/schema.json must declare a source_tier property').toBeDefined();
    expect(schema.properties.source_tier.enum).toEqual(['T1', 'T2', 'T3', 'T4', 'TX']);
  });

  // (L1, review follow-up) Two tier vocabularies coexist (this schema's T1/T2=primary-source
  // summary vs .knowledge/meta/SOURCE_TIERS.md's code-derived-KB table, where T4=external docs).
  // The description must defer to one canonical scale rather than let them silently disagree.
  it('defers to .knowledge/meta/SOURCE_TIERS.md as the canonical tier scale', () => {
    const schema = JSON.parse(readFileSync(join(REPO_ROOT, 'knowledge', 'schema.json'), 'utf8'));
    expect(schema.properties.source_tier.description).toMatch(/SOURCE_TIERS\.md/);
  });
});

// ---------------------------------------------------------------------------
// TASK-113(f) — marker-vocabulary exemption: a line enumerating >=2 quoted
// marker literals (a zod enum / vocabulary array declaring the marker
// VOCABULARY ITSELF, e.g. skills/mcp-server/references/tool-contract.md's
// `const MARKER = z.enum(['[EXPLICIT]', '[INFERRED:strong]', ...])`) is code,
// not a calibrated claim, and must not FLAG. Scope is deliberately narrow: a
// single quoted marker, or any BARE (unquoted) marker — the shape every real
// prose annotation uses — is unaffected and must still FLAG (the ticket's
// explicit scope-locking requirement).
// ---------------------------------------------------------------------------
describe('TASK-113(f) — isMarkerVocabularyLine + the marker-vocabulary exemption', () => {
  it('identifies a line with >=2 quoted marker literals as a vocabulary line', () => {
    const line = "const MARKER = z.enum(['[EXPLICIT]', '[INFERRED:strong]', '[INFERRED:weak]', '[INFERRED]', '[ASSUMED]', '[MISSING_INFO]']);";
    expect(isMarkerVocabularyLine(line)).toBe(true);
  });

  it('does NOT treat a single quoted marker, or any bare marker, as a vocabulary line', () => {
    expect(isMarkerVocabularyLine("the marker is '[ASSUMED]' in this doc")).toBe(false);
    expect(isMarkerVocabularyLine('x [INFERRED]')).toBe(false);
    expect(isMarkerVocabularyLine('- The retry limit was confirmed to be 3.')).toBe(false);
  });

  it('validateMarkers does not FLAG an uncalibrated-looking [INFERRED] inside a vocabulary line', () => {
    const line = "const MARKER = z.enum(['[EXPLICIT]', '[INFERRED:strong]', '[INFERRED:weak]', '[INFERRED]', '[ASSUMED]', '[MISSING_INFO]']);";
    expect(validateMarkers('f.md', line)).toEqual([]);
  });

  it('a REAL bare [INFERRED] on another line in the same file still FLAGs (scope-locking)', () => {
    const content = "const MARKER = z.enum(['[EXPLICIT]', '[INFERRED:strong]', '[INFERRED:weak]', '[INFERRED]', '[ASSUMED]', '[MISSING_INFO]']);\nSomething uncalibrated here [INFERRED].";
    const v = validateMarkers('f.md', content);
    expect(v).toHaveLength(1);
    expect(v[0].line).toBe(2);
  });

  it('validateTiers does not FLAG a missing source_tier on a non-mandated file whose ONLY marker occurrence is a vocabulary line', () => {
    const content = "# Some doc\n\nconst MARKER = z.enum(['[EXPLICIT]', '[INFERRED:strong]', '[INFERRED:weak]', '[INFERRED]', '[ASSUMED]', '[MISSING_INFO]']);";
    expect(validateTiers('skills/x/references/y.md', content)).toEqual([]);
  });

  it('validateTiers STILL FLAGs a missing source_tier when a real bare marker also appears (scope-locking)', () => {
    const content = "# Some doc\n\nconst MARKER = z.enum(['[EXPLICIT]', '[INFERRED:strong]']);\n\nThe API caches responses [INFERRED:weak].";
    const v = validateTiers('skills/x/references/y.md', content);
    expect(v).toHaveLength(1);
    expect(v[0].severity).toBe('FLAG');
  });

  it('real repo check: skills/mcp-server/references/tool-contract.md runs clean once source_tier is added', () => {
    const path = join(REPO_ROOT, 'skills', 'mcp-server', 'references', 'tool-contract.md');
    const content = readFileSync(path, 'utf8');
    const noise = [...validateMarkers(path, content), ...validateTiers(path, content)];
    expect(noise, `expected zero calibration findings, got:\n${renderViolations(noise)}`).toEqual([]);
  });
});

describe('AC5 — real repo run: zero tier/marker noise on knowledge/entries/*.md', () => {
  it('every committed knowledge entry either carries source_tier or is explicitly exempted', () => {
    const entriesDir = join(REPO_ROOT, 'knowledge', 'entries');
    const files = readdirSync(entriesDir).filter((n) => n.endsWith('.md'));
    expect(files.length, 'expected at least one knowledge entry to scan').toBeGreaterThan(0);

    const noise = files.flatMap((name) => {
      const path = join('knowledge', 'entries', name);
      const content = readFileSync(join(entriesDir, name), 'utf8');
      return [...validateMarkers(path, content), ...validateTiers(path, content)];
    });
    expect(noise, `expected zero calibration findings on knowledge/, got:\n${renderViolations(noise)}`).toEqual([]);
  });
});
