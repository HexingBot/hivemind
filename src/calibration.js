// calibration — marker + source-tier validators, ported 1:1 from engine-tools-mcp
// (src/tools/validate-markers.ts + validate-tiers.ts). Pure text functions, no deps. These are
// the Spine's "truth on tasks" gate: the reviewer runs them to BLOCK assumption laundering and
// tier-ceiling violations. See PLAN.md Phase 2 and .knowledge/meta/{GUARDRAILS,SOURCE_TIERS}.md.
//
// A violation is { file, line, text, rule, severity: 'BLOCKER' | 'FLAG' }.

const PLAIN_INFERRED = /\[INFERRED\](?!:(strong|weak))/g;

/** (M2) Any epistemic marker family — used to detect a non-mandated "context" doc that
 * carries markers but no source_tier, so the tier-ceiling rules stay reachable there too. */
const ANY_EPISTEMIC_MARKER = /\[(EXPLICIT|INFERRED(:strong|:weak)?|ASSUMED|MISSING_INFO)\]/;

/** A marker literal wrapped in matching quotes, e.g. `'[EXPLICIT]'` or
 * `"[INFERRED:weak]"` — the shape a zod enum / vocabulary array uses to
 * declare the marker VOCABULARY as code, never how a real prose annotation
 * writes a marker (those are always bare: `[EXPLICIT]`). */
const QUOTED_MARKER_LITERAL = /(['"])\[(?:EXPLICIT|INFERRED(?::strong|:weak)?|ASSUMED|MISSING_INFO)\]\1/g;

/**
 * (TASK-113 f) A line enumerating >=2 quoted marker literals (e.g.
 * `z.enum(['[EXPLICIT]', '[INFERRED:strong]', ...])`) is code declaring the
 * marker vocabulary itself, not a calibrated claim — exempt from every
 * marker/tier check below. Deliberately narrow: a single quoted marker, or
 * any bare (unquoted) marker — the shape every real prose annotation uses —
 * is NOT a vocabulary line and still triggers normal detection.
 */
export function isMarkerVocabularyLine(line) {
  const matches = line.match(QUOTED_MARKER_LITERAL);
  return !!matches && matches.length >= 2;
}

/** Per-tier marker ceiling: which markers a file/claim of each source tier may carry. */
export const TIER_MARKER_CEILING = {
  T1: ['[EXPLICIT]', '[INFERRED:strong]', '[INFERRED:weak]', '[INFERRED]', '[ASSUMED]', '[MISSING_INFO]'],
  T2: ['[EXPLICIT]', '[INFERRED:strong]', '[INFERRED:weak]', '[INFERRED]', '[ASSUMED]', '[MISSING_INFO]'],
  T3: ['[INFERRED:strong]', '[INFERRED:weak]', '[INFERRED]', '[ASSUMED]', '[MISSING_INFO]'],
  T4: ['[ASSUMED]', '[MISSING_INFO]'],
  TX: [],
};

/** Same-file marker hygiene: uncalibrated [INFERRED] (FLAG) + unmarked claim language (FLAG). */
export function validateMarkers(filePath, content) {
  const violations = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // (TASK-113 f) A marker-vocabulary line (e.g. a zod enum literal
    // enumerating every marker string) is code, not a claim — skip it.
    if (isMarkerVocabularyLine(line)) continue;

    // G5/PG5 — plain [INFERRED] without calibration (flag, not block — some uses are valid)
    for (const match of line.matchAll(PLAIN_INFERRED)) {
      violations.push({
        file: filePath, line: lineNum, text: match[0],
        rule: 'G5/PG5 — uncalibrated [INFERRED]; prefer [INFERRED:strong] or [INFERRED:weak]',
        severity: 'FLAG',
      });
    }

    // G3/PG3 — a "confirmed/decided/resolved/proven" claim with no marker at all.
    // (R3) The previous version pre-filtered on a literal, case-sensitive
    // `line.includes('confirmed')` before ever reaching the case-insensitive
    // \b(confirmed|decided|resolved|proven)\b test below — which made
    // 'decided'/'resolved'/'proven' and any capitalized form ('Confirmed',
    // 'Decided') dead code, since those never contain the substring 'confirmed'.
    if (/\b(confirmed|decided|resolved|proven)\b/i.test(line) && line.trim().startsWith('-')
      && !line.includes('[EXPLICIT]') && !line.includes('[INFERRED') && !line.includes('[ASSUMED]')) {
      violations.push({
        file: filePath, line: lineNum, text: line.trim().slice(0, 80),
        rule: "G3/PG3 — 'confirmed/decided' claim has no marker; verify it's [EXPLICIT] or [INFERRED:strong]",
        severity: 'FLAG',
      });
    }
  }

  return violations;
}

/**
 * Assumption laundering (the BLOCKER): a weak claim ([ASSUMED]/[INFERRED:weak]) in the source
 * that reappears downstream with its marker dropped. This is the cross-file check the reviewer
 * runs when a ticket/diff restates a calibrated claim from the brain or a source doc.
 */
export function validateMarkerForwarding(sourceContent, derivedContent, sourcePath, derivedPath) {
  const violations = [];

  const weakClaims = [];
  for (const match of sourceContent.matchAll(/([^.\n]{10,80})\s*\[(ASSUMED|INFERRED:weak)\]/g)) {
    weakClaims.push(match[1].trim().slice(0, 40));
  }

  const derivedLines = derivedContent.split('\n');
  for (let i = 0; i < derivedLines.length; i++) {
    const line = derivedLines[i];
    for (const claim of weakClaims) {
      if (line.includes(claim) && !line.includes('[ASSUMED]') && !line.includes('[INFERRED')) {
        violations.push({
          file: derivedPath, line: i + 1,
          text: line.trim().slice(0, 80),
          rule: `G3/PG3 — claim from ${sourcePath} was [ASSUMED]/[INFERRED:weak] but marker dropped here`,
          severity: 'BLOCKER',
        });
        break;
      }
    }
  }

  return violations;
}

/**
 * (M1, review follow-up) Parse `content` as a JSON object and return it, or
 * null if it isn't valid JSON (YAML frontmatter, malformed/corrupted data,
 * or any non-JSON surface). Used so extractTier/isExemptTierSurface read
 * ONLY the real top-level field of an actual JSON object, never a
 * content-wide regex match — a regex can be fooled by a spoof substring
 * sitting in malformed/corrupted content that never actually parses; a
 * parse failure must fail closed (no tier, not exempt), not fall back to
 * text-scanning the raw bytes.
 */
function tryParseJsonObject(content) {
  try {
    const parsed = JSON.parse(content);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Extract the source_tier (T1..T4/TX) from either the JSON-property form
 * used by tasks/*.json (`"source_tier": "T1"`) or YAML frontmatter
 * (`source_tier: T1`). (AC3, hardened per M1) When `content` parses as a
 * JSON object, ONLY its top-level `source_tier` field is authoritative —
 * this is immune to a spoof value quoted inside a nested string (e.g. a
 * ticket's own `description`), because valid JSON escapes any embedded
 * quote, and malformed content that isn't valid JSON never reaches this
 * branch at all (fails closed to the YAML-regex fallback, which itself
 * won't match free-floating JSON-ish text). Non-JSON content (markdown
 * frontmatter) falls through to the line-anchored YAML regex.
 */
export function extractTier(content) {
  const obj = tryParseJsonObject(content);
  if (obj) {
    return (typeof obj.source_tier === 'string' && /^T[1-4X]$/.test(obj.source_tier)) ? obj.source_tier : null;
  }
  const match = content.match(/^source_tier:\s*(T[1-4X])\s*$/m);
  return match ? match[1] : null;
}

/**
 * (R3/AC1) The two concrete, machine-checkable surfaces agents/reviewer.md's
 * calibration gate mandates a source_tier on: knowledge entries and ticket
 * files. Deliberately narrow — NOT "every markdown file" or "every JSON
 * file" — so the BLOCKER below can never fire on unrelated repo surfaces
 * (README, commands/*.md, schema/index/graph files) that carry no
 * source_tier convention and never will.
 */
export function isMandatedTierSurface(filePath) {
  const p = filePath.replace(/\\/g, '/');
  return /(^|\/)knowledge\/entries\/[^/]+\.md$/.test(p) || /(^|\/)tasks\/TASK-[0-9]+\.json$/.test(p);
}

/**
 * (R3/AC1) Exemption: a mandated ticket file whose lifecycle has already
 * closed (`status: "done"`) is grandfathered — retrofitting tier metadata
 * onto closed historical tickets is out of scope for the mandate, which
 * binds active work (todo/in_progress/in_review/blocked), not the audit
 * trail. Knowledge entries carry no such exemption: they are living docs,
 * always re-editable, so the mandate always applies to them.
 *
 * (M1, review follow-up) Reads ONLY the top-level `status` field of the
 * parsed JSON object — never a content-wide regex — so a ticket's own
 * `description`/comment `body` can safely discuss another ticket's status
 * (e.g. "TASK-005 has status: done") without falsely exempting itself.
 * Unparseable content fails closed: never exempt.
 */
export function isExemptTierSurface(filePath, content) {
  const p = filePath.replace(/\\/g, '/');
  if (!/(^|\/)tasks\/TASK-[0-9]+\.json$/.test(p)) return false;
  const obj = tryParseJsonObject(content);
  return !!obj && obj.status === 'done';
}

/** (TASK-113 f) Same as ANY_EPISTEMIC_MARKER.test(content), but ignores marker
 * occurrences confined to a marker-vocabulary line (isMarkerVocabularyLine)
 * so a code file enumerating the marker vocabulary as a zod enum / array
 * literal does not falsely read as "this file makes epistemic claims". */
function hasRealEpistemicMarker(content) {
  return content
    .split('\n')
    .some((line) => !isMarkerVocabularyLine(line) && ANY_EPISTEMIC_MARKER.test(line));
}

/** Source-tier ceiling: T3/T4 can't be [EXPLICIT], T4 can't be [INFERRED], TX is rejected. */
export function validateTiers(filePath, content) {
  const violations = [];
  const tier = extractTier(content);
  if (!tier) {
    if (isMandatedTierSurface(filePath) && !isExemptTierSurface(filePath, content)) {
      violations.push({
        file: filePath, line: 1, text: '(frontmatter)',
        rule: 'source_tier missing from a mandated surface — add T1/T2/T3/T4/TX or document an exemption',
        severity: 'BLOCKER',
      });
    } else if (!isMandatedTierSurface(filePath) && hasRealEpistemicMarker(content)) {
      // (M2, review follow-up) A non-mandated "context" doc (agents/reviewer.md:54 names
      // "context" as a calibrated surface) that carries epistemic markers but no
      // source_tier makes the ceiling rules below unreachable for it — flag it (not
      // block; the mandate itself is still narrowly scoped to knowledge/tickets). A
      // marker-free non-mandated doc stays completely silent — AC5's "no uniform FLAG
      // wall" guarantee only applies to files that never mention calibration at all.
      violations.push({
        file: filePath, line: 1, text: '(frontmatter)',
        rule: 'source_tier missing on a file carrying epistemic markers — tier-ceiling rules are unreachable without it',
        severity: 'FLAG',
      });
    }
    // Non-mandated, marker-free surfaces produce no finding at all — no uniform FLAG wall (AC5).
    return violations;
  }

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // (TASK-113 f) Same vocabulary-line exemption as validateMarkers — a
    // quoted enum literal enumerating markers is code, not a claim, so it
    // never trips a tier-ceiling violation either.
    if (isMarkerVocabularyLine(line)) continue;

    if (tier === 'T3' || tier === 'T4') {
      if (line.includes('[EXPLICIT]')) {
        violations.push({
          file: filePath, line: lineNum, text: line.trim().slice(0, 80),
          rule: `Tier ceiling violation — file is ${tier} but uses [EXPLICIT] (requires T1/T2)`,
          severity: 'BLOCKER',
        });
      }
    }

    if (tier === 'T4') {
      if (line.includes('[INFERRED')) {
        violations.push({
          file: filePath, line: lineNum, text: line.trim().slice(0, 80),
          rule: 'Tier ceiling violation — file is T4 but uses [INFERRED] (T4 is orientation only; claims require T3+)',
          severity: 'BLOCKER',
        });
      }
    }

    if (tier === 'TX') {
      violations.push({
        file: filePath, line: 1, text: '(file)',
        rule: 'TX-tier file — this material is rejected and must not be used for claims',
        severity: 'BLOCKER',
      });
      break;
    }
  }

  return violations;
}

/** Render violations for a human/agent report. */
export function renderViolations(violations) {
  if (violations.length === 0) return 'No calibration violations found.';
  return violations
    .map((v) => `  [${v.severity}] ${v.file}:${v.line} — ${v.rule}\n    "${v.text}"`)
    .join('\n\n');
}

/** Convenience: split a violation list into blockers vs flags (the reviewer blocks on blockers). */
export function partition(violations) {
  return {
    blockers: violations.filter((v) => v.severity === 'BLOCKER'),
    flags: violations.filter((v) => v.severity === 'FLAG'),
  };
}
