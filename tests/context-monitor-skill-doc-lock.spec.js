// tests/context-monitor-skill-doc-lock.spec.js
// TASK-210 fix round (HIGH-2) — pins the "Settings.json Scaffold" JSON
// example in skills/claude-code-context-monitor/SKILL.md §7 against the REAL
// output of buildContextMonitorEntries, instead of leaving the doc free to
// silently regress to the flat (non-firing) shape a developer might copy
// verbatim while editing this subsystem — the exact gap the reviewer found:
// the code sensor (tests/context-monitor-hook-shape.spec.js) existed, but
// nothing pinned the DOCUMENTED example a human reads before touching this
// code. Modeled on tests/uat-doc-example-lock.spec.js's precedent: extract a
// marked block from the doc by a stable marker, run it through the real code
// path, never re-encode the schema as a second hand-rolled check.
//
// Only one copy of this skill exists (plugin-root skills/, no .claude/skills/
// mirror — confirmed via `ls .claude/skills` at TASK-210 fix-round time), so
// no parity byte-identity check is needed here.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';
import { buildContextMonitorEntries } from '../src/claude-settings.js';
import { collectFormatViolations } from './helpers/hookShapeViolations.js';

const SKILL_PATH = join(REPO_ROOT, 'skills', 'claude-code-context-monitor', 'SKILL.md');
const START_MARKER = '<!-- SETTINGS-SCAFFOLD-EXAMPLE:START -->';
const END_MARKER = '<!-- SETTINGS-SCAFFOLD-EXAMPLE:END -->';
const PLACEHOLDER_ROOT = '<ABSOLUTE_PLUGIN_ROOT>';

/**
 * Extract and JSON.parse the fenced ```json block strictly between
 * START_MARKER and END_MARKER. Throws loudly (never an empty/undefined
 * pass-through — CLAUDE.md's Empty-result contract) if the markers or the
 * fenced block are missing.
 */
function extractScaffoldExample() {
  const text = readFileSync(SKILL_PATH, 'utf8');
  const startIdx = text.indexOf(START_MARKER);
  const endIdx = text.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    throw new Error(
      `context-monitor-skill-doc-lock: could not find a well-formed ${START_MARKER} ... `
        + `${END_MARKER} block in ${SKILL_PATH} — the doc no longer publishes the settings `
        + 'scaffold example this lock checks (or the markers were removed/reordered).',
    );
  }
  const between = text.slice(startIdx + START_MARKER.length, endIdx);
  const fenceMatch = between.match(/```json\s*([\s\S]*?)```/);
  if (!fenceMatch) {
    throw new Error(
      'context-monitor-skill-doc-lock: no ```json fenced block found between the markers.',
    );
  }
  const raw = fenceMatch[1].trim();
  if (raw === '') {
    throw new Error('context-monitor-skill-doc-lock: the fenced JSON block is empty.');
  }
  return JSON.parse(raw);
}

// Cross-platform path separators: buildContextMonitorEntries uses node:path's
// join, which emits backslashes on win32; the doc (and the real
// ${CLAUDE_PLUGIN_ROOT}-independent example) uses forward slashes. Normalize
// both sides before comparing, same technique repin.mjs uses for staleness
// comparison.
function normalizeSeps(s) {
  return s.replace(/\\/g, '/');
}

describe('TASK-210 HIGH-2 — SKILL.md §7 settings scaffold example vs buildContextMonitorEntries', () => {
  it('the doc publishes a non-empty, parseable JSON example (vacuity guard)', () => {
    const doc = extractScaffoldExample();
    expect(doc).toBeTypeOf('object');
    expect(doc.hooks).toBeDefined();
  });

  it('the published example matches buildContextMonitorEntries\'s real output byte-for-byte (modulo path separators)', () => {
    const doc = extractScaffoldExample();
    const entries = buildContextMonitorEntries(PLACEHOLDER_ROOT);

    // Normalize STRING LEAF VALUES only (not a stringify+global-replace,
    // which would also mangle JSON's own backslash-escaped quote syntax).
    const normalize = (value) => {
      if (typeof value === 'string') return normalizeSeps(value);
      if (Array.isArray(value)) return value.map(normalize);
      if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v)]));
      }
      return value;
    };

    expect(normalize(doc.statusLine)).toEqual(normalize({ type: entries.statusLine.type, command: entries.statusLine.command }));
    expect(normalize(doc.hooks.Stop[0])).toEqual(normalize(entries.stopHook));
    expect(normalize(doc.hooks.SessionStart[0])).toEqual(normalize(entries.sessionStartHook));
  });

  it('the published example produces ZERO violations against the real hooks-shape validator', () => {
    const doc = extractScaffoldExample();
    expect(collectFormatViolations(doc)).toEqual([]);
  });

  // Non-vacuity: the OLD flat shape this doc used to publish (pre-TASK-210)
  // must be REJECTED by the same validator, proving the check above is not
  // vacuously true regardless of shape.
  it('non-vacuity: the OLD flat shape (what this doc used to say) is REJECTED', () => {
    const oldFlatDoc = {
      hooks: {
        Stop: [{ type: 'command', command: 'node <ABSOLUTE_PLUGIN_ROOT>/context-monitor/stop-hook.mjs' }],
        SessionStart: [{
          type: 'command',
          matcher: 'clear|compact',
          command: 'node <ABSOLUTE_PLUGIN_ROOT>/context-monitor/session-start.mjs',
        }],
      },
    };
    const violations = collectFormatViolations(oldFlatDoc);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.includes('flat top-level "command"'))).toBe(true);
  });
});
