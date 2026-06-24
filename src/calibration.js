// calibration — marker + source-tier validators, ported 1:1 from engine-tools-mcp
// (src/tools/validate-markers.ts + validate-tiers.ts). Pure text functions, no deps. These are
// the Spine's "truth on tasks" gate: the reviewer runs them to BLOCK assumption laundering and
// tier-ceiling violations. See PLAN.md Phase 2 and .knowledge/meta/{GUARDRAILS,SOURCE_TIERS}.md.
//
// A violation is { file, line, text, rule, severity: 'BLOCKER' | 'FLAG' }.

const PLAIN_INFERRED = /\[INFERRED\](?!:(strong|weak))/g;

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

    // G5/PG5 — plain [INFERRED] without calibration (flag, not block — some uses are valid)
    for (const match of line.matchAll(PLAIN_INFERRED)) {
      violations.push({
        file: filePath, line: lineNum, text: match[0],
        rule: 'G5/PG5 — uncalibrated [INFERRED]; prefer [INFERRED:strong] or [INFERRED:weak]',
        severity: 'FLAG',
      });
    }

    // G3/PG3 — a "confirmed/decided/resolved/proven" claim with no marker at all
    if (line.includes('confirmed') && !line.includes('[EXPLICIT]') && !line.includes('[INFERRED') && !line.includes('[ASSUMED]')) {
      if (/\b(confirmed|decided|resolved|proven)\b/i.test(line) && line.trim().startsWith('-')) {
        violations.push({
          file: filePath, line: lineNum, text: line.trim().slice(0, 80),
          rule: "G3/PG3 — 'confirmed/decided' claim has no marker; verify it's [EXPLICIT] or [INFERRED:strong]",
          severity: 'FLAG',
        });
      }
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

/** Extract the source_tier (T1..T4/TX) from frontmatter, or null. */
export function extractTier(content) {
  const match = content.match(/source_tier:\s*(T[1-4X])/);
  return match ? match[1] : null;
}

/** Source-tier ceiling: T3/T4 can't be [EXPLICIT], T4 can't be [INFERRED], TX is rejected. */
export function validateTiers(filePath, content) {
  const violations = [];
  const tier = extractTier(content);
  if (!tier) {
    violations.push({
      file: filePath, line: 1, text: '(frontmatter)',
      rule: 'source_tier missing from frontmatter — add T1/T2/T3/T4',
      severity: 'FLAG',
    });
    return violations;
  }

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

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
