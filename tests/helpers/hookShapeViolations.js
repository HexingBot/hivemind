// tests/helpers/hookShapeViolations.js
// TASK-138 — shared validator for the canonical Claude Code hooks.json shape:
//   { hooks: { <EventName>: [ { matcher?, hooks: [ { type, command } ] } ] } }
// Extracted (TASK-210 fix round, LOW-5) so every spec pinning this schema
// reuses ONE validator instead of hand-rolling its own — two validators for
// one schema can drift. Originally defined inline in
// tests/plugin-hooks-format.spec.js (TASK-138); also used by
// tests/context-monitor-hook-shape.spec.js (TASK-210) to validate
// buildContextMonitorEntries's output against the same schema.

/**
 * Applies every structural assertion of the canonical nested hooks shape to
 * a parsed hooks document (or any object matching the same
 * `{ hooks: { <Event>: [...] } }` wrapper). Returns a list of violation
 * messages (empty = valid).
 *
 * @param {*} doc
 * @returns {string[]}
 */
export function collectFormatViolations(doc) {
  const violations = [];

  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    violations.push('document root must be an object');
    return violations;
  }

  const hooksRecord = doc.hooks;
  if (hooksRecord === undefined) {
    violations.push('missing top-level "hooks" key');
    return violations;
  }
  if (typeof hooksRecord !== 'object' || hooksRecord === null || Array.isArray(hooksRecord)) {
    violations.push('top-level "hooks" must be a plain object (record), not undefined/array');
    return violations;
  }

  for (const [eventName, eventValue] of Object.entries(hooksRecord)) {
    if (!Array.isArray(eventValue)) {
      violations.push(`hooks.${eventName} must be an array`);
      continue;
    }
    for (const [i, entry] of eventValue.entries()) {
      const label = `hooks.${eventName}[${i}]`;

      // Regression guard: no flat top-level command/type sibling of matcher.
      if (typeof entry?.command === 'string') {
        violations.push(`${label} has a flat top-level "command" sibling of "matcher" (old buggy shape)`);
      }
      if (typeof entry?.type === 'string') {
        violations.push(`${label} has a flat top-level "type" sibling of "matcher" (old buggy shape)`);
      }

      if (!Array.isArray(entry?.hooks)) {
        violations.push(`${label} must have a nested "hooks" array`);
        continue;
      }
      for (const [j, nested] of entry.hooks.entries()) {
        const nestedLabel = `${label}.hooks[${j}]`;
        if (typeof nested?.type !== 'string') {
          violations.push(`${nestedLabel}.type must be a string`);
        }
        if (typeof nested?.command !== 'string') {
          violations.push(`${nestedLabel}.command must be a string`);
        }
      }
    }
  }

  return violations;
}
