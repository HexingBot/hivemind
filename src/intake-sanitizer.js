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

// TASK-159 — SECURITY: invisible Unicode characters. Unlike the structural
// forgery covered above (which is about visible markdown markers), this class
// of value is invisible to a human reviewer but still tokenizable by an LLM
// reading the raw file bytes (probe P9: a Unicode Tag-block-encoded hidden
// instruction rides along inside an otherwise-innocuous success_criteria
// string). \p{Cf} ("format" category) is the precise Unicode classification
// for characters whose entire purpose is to affect rendering/processing
// without themselves being visible — it covers the Tag block (U+E0000-
// U+E007F, the exact probe P9 vector), zero-width space/joiners (U+200B-
// U+200D), the BOM/ZWNBSP (U+FEFF), soft hyphen (U+00AD), and similar. It
// deliberately does NOT match combining marks (Mn), CJK (Lo), or emoji (So) —
// those are ordinary, visible Unicode and must survive untouched (AC4). The
// second alternative strips non-whitespace C0/C1 control characters (bare
// \x00-\x1F/\x7F-\x9F) EXCEPT tab/LF/CR, which remain meaningful in
// multi-line prose fields and are handled by escapeMarkdownStructure /
// rejectControlChars instead.
// RC-loop follow-up (MEDIUM): \p{Cf} only matches ASSIGNED Unicode codepoints.
// The Tag block (decimal 917504-917631, i.e. U+E0000-U+E007F) has 31
// UNASSIGNED codepoints at its low end (U+E0000, U+E0002-U+E001F) that fall
// outside Cf's coverage — no live payload exploits this today (the P9
// encoder only emits the assigned, printable U+E0020-U+E007E sub-range,
// which Cf already catches), but AC1's contract is an absolute "no codepoint
// in U+E0000-U+E007F survives", not "no ASSIGNED codepoint survives", and
// relying on assignment status is version-fragile (a future Unicode version
// could assign those 31 codepoints, silently changing behavior). The numeric
// range check below closes that gap directly — a plain decimal comparison,
// not a literal `/[\u{...}-\u{...}]/u` regex escape range (kept in the
// robust numeric form per this module's TASK-159 note on avoiding literal
// escape-range syntax).
const TAG_BLOCK_START = 0xe0000; // 917504
const TAG_BLOCK_END = 0xe007f; // 917631

// RC-loop follow-up (LOW, accepted trade-off): \p{Cf} strips ALL Unicode
// "format" characters, which also includes a handful of legitimate
// script-specific format signs (Arabic number signs U+0600-0605/U+06DD,
// Syriac abbreviation mark U+070F, Kaithi number signs, etc.) alongside the
// invisible-injection vectors this module targets. Accepted: intake is
// English-first, the security value (tag-block/zero-width/bidi
// neutralization) outweighs the rare degradation, and the failure mode is
// graceful (a sign is dropped, never injected) — AC4 only pins Latin/CJK/
// emoji preservation, not these scripts.
const FORMAT_CHAR_RE = /\p{Cf}/u;

// Non-whitespace C0/C1 control code points are also invisible-in-render, but
// deliberately excluded from FORMAT_CHAR_RE's scope (Cf is a narrower,
// display-focused category). Tab (9), LF (10), and CR (13) are EXCLUDED from
// this strip set on purpose: tab is ordinary whitespace, and LF/CR remain
// meaningful line separators in multi-line prose fields, already governed by
// escapeMarkdownStructure (multi-line contexts) and rejectControlChars
// (single-line Stack contexts) elsewhere in this module — stripping them here
// too would silently collapse legitimate multi-paragraph input.
function isStrippableControlCodePoint(codePoint) {
  if (codePoint === 9 || codePoint === 10 || codePoint === 13) return false;
  if (codePoint <= 31) return true; // C0 controls
  if (codePoint >= 127 && codePoint <= 159) return true; // DEL + C1 controls
  if (codePoint >= TAG_BLOCK_START && codePoint <= TAG_BLOCK_END) return true; // Tag block, assigned or not
  return false;
}

/**
 * Strip invisible-rendering Unicode characters from a single string value:
 * Unicode Tag-block characters (U+E0000-U+E007F — probe P9's exact payload
 * encoding), zero-width joiners/spaces and the BOM (all Unicode category Cf,
 * "format"), and non-whitespace control characters. Ordinary visible Unicode
 * — combining marks, CJK, emoji, accented Latin — is category Mn/Lo/So/Ll and
 * is left untouched (AC4). Iterates by CODE POINT (`for...of` over a string),
 * not by UTF-16 code unit, so supplementary-plane characters like the Tag
 * block (which are surrogate pairs in UTF-16) are matched/removed whole
 * rather than corrupting a lone surrogate half.
 *
 * STRIP (not reject) is the design choice here: a legitimate user does not
 * knowingly type Tag-block or zero-width characters, so silently dropping
 * them is friendlier than aborting the whole intake step over a field the
 * human cannot even see is offending (see this module's TASK-159 extension
 * note at the top of the file for the full strip-vs-reject rationale).
 *
 * @param {unknown} value
 * @returns {unknown} the stripped string, or `value` unchanged if it is not
 *   a non-empty string
 */
export function stripInvisibleChars(value) {
  if (typeof value !== 'string' || value.length === 0) return value;
  let out = '';
  for (const ch of value) {
    const codePoint = ch.codePointAt(0);
    if (isStrippableControlCodePoint(codePoint)) continue;
    if (FORMAT_CHAR_RE.test(ch)) continue;
    out += ch;
  }
  return out;
}

/**
 * Recursively apply stripInvisibleChars to every string reachable from
 * `answers` — top-level scalars, array items (e.g. goals/scope_in/scope_out),
 * and nested object values (e.g. agent_models, perfil_proyecto) — and return
 * a NEW value; the input is never mutated. This is the single seam both
 * writeProjectMd and generateProjectContext call at the very top of intake
 * processing (TASK-159 AC2: every field that flows into PROJECT.md or
 * project-context.md is covered, not just success_criteria), and each sink
 * calls it independently so generateProjectContext is protected even when
 * invoked with a fresh `answers` map that bypasses writeProjectMd entirely
 * (mirrors the existing rejectControlChars call-twice pattern in this module,
 * same rationale).
 *
 * @param {unknown} value
 * @returns {unknown}
 */
export function sanitizeInvisibleCharsDeep(value) {
  if (typeof value === 'string') return stripInvisibleChars(value);
  if (Array.isArray(value)) return value.map(sanitizeInvisibleCharsDeep);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = sanitizeInvisibleCharsDeep(v);
    }
    return out;
  }
  return value;
}

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
