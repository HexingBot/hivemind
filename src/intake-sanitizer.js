// src/intake-sanitizer.js
// TASK-158 — shared intake-boundary sanitizer for markdown structure/directive
// forgery in agent-facing generated files (PROJECT.md via src/project-md.js,
// project-context.md via src/agent-generator.js). Untrusted free-text intake
// values must not be able to forge FRAMEWORK-authored markdown structure
// (headings, code fences) or masquerade as a framework-authored directive in
// files that subagents read as trusted context. This module is the ONE shared
// seam both sinks call into, per the ticket's "converge on one sanitizer"
// instruction — TASK-159 (Unicode Tag-block/invisible-char stripping) and
// TASK-161 (perfil_proyecto frontmatter map-value injection) are expected to
// extend it rather than duplicate it (see each export's docstring for the
// extension point).
//
// Two contexts, two mechanisms (see the ticket's scope-discipline note):
//
//   1. SINGLE-LINE contexts (the `- key: value` Stack bullet in both
//      project-md.js and agent-generator.js): rejectControlChars throws a
//      loud, field-naming Error BEFORE any disk write when the key or value
//      contains \r or \n. A newline here would let the value escape its one
//      Stack bullet line and forge arbitrary new markdown lines/headings/
//      fences directly in the ## Stack section (probe P3). REJECT (not
//      escape) mirrors TASK-157's precedent for project_name/project_type/
//      tier — same chokepoint shape, same fix, and matches the ticket's AC1
//      "or the render fails loudly" alternative.
//
//   2. MULTI-LINE prose / bullet contexts (## Description, ## Goals, ## Scope,
//      the project-context.md briefing prose): escapeMarkdownStructure
//      neutralizes any line that would parse as a markdown ATX heading
//      (^#{1,6}\s), a code-fence delimiter (``` / ~~~), or a setext-heading
//      underline / thematic break (a bare run of -/=/*/_ characters — e.g.
//      "License\n---" renders as a real <h2> with NO leading marker on the
//      heading line itself; "---"/"***"/"___" alone renders <hr>) by
//      inserting a backslash immediately before the marker — a standard
//      CommonMark escape that keeps the line's own words legible but strips
//      its ability to open a new section, fence, or heading (probes
//      P3-adjacent Stack rendering in agent-generator.js / P4 / P4-setext).
//      renderBulletLines applies the same per-line escape to bullet-list
//      items (## Goals / ## Scope (in)/(out) / ## Primary use cases) and
//      additionally re-indents any embedded continuation line to the
//      bullet's continuation width (2 spaces) so CommonMark keeps it
//      attached to the SAME list item rather than letting it break out into
//      an unattributed top-level paragraph immediately under the section
//      heading (probe P8: this is what turns "SYSTEM NOTE TO AGENT: ..."
//      from a free-floating directive-shaped paragraph into a subordinate
//      continuation of the user's own goal bullet — attributed to that
//      bullet, not to the framework).
//
//   Round-trip note (TASK-158 RC-loop MEDIUM): escapeMarkdownStructure is a
//   ONE-WAY sanitizer — readProjectMd does NOT unescape a leading `\#`/`\```/
//   `\-`/`\=`/`\*`/`\_` on read. This is a deliberate choice (option B from
//   the RC-loop resolution), not an oversight: body prose that legitimately
//   starts a line with a structural marker character is persisted in its
//   neutralized (escaped) form, and that is the value readProjectMd returns
//   on subsequent reads. The transform is idempotent (escaping an
//   already-escaped line is a no-op — the leading character is now `\`, which
//   none of the structural regexes match), so repeated write/read cycles are
//   stable even though the very first write is not byte-identical to the
//   original input for such lines. See
//   tests/e2e/intake-structure-forgery.spec.js's "round-trip decision" case
//   for the pinned behavior and project-md.js's BODY_SECTIONS prose branch
//   for the call site.

const ATX_HEADING_RE = /^( {0,3})(#{1,6})(\s|$)/;
const CODE_FENCE_RE = /^( {0,3})(`{3,}|~{3,})/;
// Setext heading underline ('---' / '===') and thematic break ('---', '***',
// '___', optionally space-separated repeats of the SAME character). CommonMark
// promotes the line immediately ABOVE a bare underline like this into a
// heading with no leading marker at all on the heading line itself — the
// ATX/fence checks above cannot catch this because the forged heading text
// ("License") is itself perfectly ordinary prose; only the underline line is
// structurally distinctive, so that is the line we neutralize. Escaping is
// conservative — a line that's only spacing plus one repeated marker
// character is escaped whether or not it happens to reach the 3-character
// thematic-break minimum, since a single/double '-' or '=' line is still a
// valid setext underline.
const SETEXT_OR_BREAK_RE = /^( {0,3})([=\-*_])(?:[ \t]*\2)*[ \t]*$/;

/**
 * Throw a loud, field-naming Error if `value` is a string containing \r or
 * \n. Used at both sinks' Stack-bullet render loops (single-line context) so
 * a key or value can never escape its `- key: value` line.
 *
 * @param {unknown} value
 * @param {string} label - human-readable description of the offending field,
 *   included verbatim in the thrown message.
 */
export function rejectControlChars(value, label) {
  if (typeof value === 'string' && /[\r\n]/.test(value)) {
    throw new Error(
      `${label} must not contain newline or carriage-return characters — ` +
      'they would let the value escape its single-line Stack bullet and ' +
      'forge arbitrary new lines/headings/fences (control-character injection)',
    );
  }
}

// Escape a single line if (and only if) it would otherwise parse as an ATX
// heading, a code-fence delimiter, a setext-heading underline, or a
// thematic break. All other lines (including blank lines and ordinary
// prose) pass through unchanged. Idempotent: re-running this on an
// already-escaped line is a no-op, since the leading character is now `\`,
// which none of the three regexes match.
function escapeStructuralLine(line) {
  const h = line.match(ATX_HEADING_RE);
  if (h) {
    const idx = h[1].length;
    return line.slice(0, idx) + '\\' + line.slice(idx);
  }
  const f = line.match(CODE_FENCE_RE);
  if (f) {
    const idx = f[1].length;
    return line.slice(0, idx) + '\\' + line.slice(idx);
  }
  const s = line.match(SETEXT_OR_BREAK_RE);
  if (s) {
    const idx = s[1].length;
    return line.slice(0, idx) + '\\' + line.slice(idx);
  }
  return line;
}

/**
 * Neutralize line-start markdown structural markers (ATX headings, code
 * fences, setext-heading underlines, thematic breaks) in a multi-line prose
 * string. Blank lines and ordinary prose are left untouched — legitimate
 * multi-paragraph descriptions still render readably (this is NOT a general
 * prompt-injection filter; it only strips the ability to forge a new
 * markdown section, fence, or heading). NOT reversed on read — see the
 * "Round-trip note" in this module's header comment.
 *
 * @param {string} text
 * @returns {string}
 */
export function escapeMarkdownStructure(text) {
  if (typeof text !== 'string' || text.length === 0) return text;
  return text.split(/\r?\n/).map(escapeStructuralLine).join('\n');
}

/**
 * Render a single bullet-list item as one or more output lines: the first
 * line carries the leading `- ` marker; any embedded continuation line
 * (from a newline inside the item) is heading/fence-escaped and re-indented
 * to the bullet's continuation width (2 spaces) so it stays attached to this
 * SAME list item under CommonMark rules, rather than breaking out into a
 * free-standing, unattributed paragraph. Blank continuation lines stay
 * blank (no indentation added to whitespace-only lines).
 *
 * @param {unknown} item
 * @returns {string[]} lines ready to push onto the render buffer
 */
export function renderBulletLines(item) {
  const lines = String(item).split(/\r?\n/).map(escapeStructuralLine);
  const out = [`- ${lines[0]}`];
  for (let i = 1; i < lines.length; i++) {
    out.push(lines[i].length === 0 ? '' : `  ${lines[i]}`);
  }
  return out;
}
