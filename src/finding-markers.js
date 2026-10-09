// src/finding-markers.js
// TASK-240 (WG-3) — the ONE parser of finding-marker state, split out of src/task-store.js so that
// src/wargame-wrecker.js (bundled into dist/init.cjs) can share it with the close guard without
// dragging task-store.js and its schema validator into that bundle. Pure text parsing, no I/O.
// checkNoOpenHighFindings (task-store.js) and the wargame record builder both read markers through
// collectFindingMarkerState, so a marker the guard counts is counted identically everywhere.
// Moved verbatim from task-store.js; behavior is unchanged.

// BRAILLE PATTERN BLANK etc.: see the rationale in task-store.js's delivery-body section.
const KNOWN_BLANK_GLYPHS = '⠀'; // BRAILLE PATTERN BLANK — see above.
export const IGNORABLE_OR_BLANK_RE = new RegExp(
  `[\\p{Cf}\\p{Default_Ignorable_Code_Point}\\p{M}${KNOWN_BLANK_GLYPHS}]`, 'gu',
);

// TASK-238 — id-shape bound, and the two caps behind it. HARM this closes:
// the old `[^\]]+` was unbounded, so any comment PROSE that happened to
// start with the marker's literal syntax got its "id" match extended all
// the way to the next `]` ANYWHERE later in the same comment — measured on
// TASK-234's own comments[3] (offset 3213): a reviewer sentence describing
// the marker convention itself ("El marcador [FINDING-HIGH: aparece en...")
// swallowed ~1196 chars before hitting an unrelated closing bracket, and the
// resulting ~1190-char "id" could never be resolved by any
// `[FINDING-RESOLVED: <id>]`, leaving the ticket incerrable.
//
// FINDING_ID_MAX_LEN is generous against the longest real id in this repo's
// own corpus (11 chars, e.g. "WG4-236-002") but far short of a sentence.
// FINDING_MARKER_SCAN_CAP bounds how far past the marker's colon the FAST,
// WELL-FORMED path below (FINDING_HIGH_RE/FINDING_RESOLVED_RE) will look for
// a closing `]` before giving up on that path entirely (the TASK-234
// runaway-prose case, CU2, whose real gap is ~1196 chars — comfortably past
// this cap). 200 sits comfortably above any realistic id attempt and far
// below that gap, so a genuine attempt and runaway prose stay distinguishable
// ON THIS PATH ALONE.
//
// WG5-238-001 (FIFTH wargaming pass, 2026-09-17) — that "on this path alone"
// qualifier is load-bearing and used to be missing from this comment, which
// is exactly the bug: when the well-formed regex fails to find a `]` within
// the cap, it does not match AT ALL at that position (a bounded quantifier
// immediately followed by a required literal simply fails to match — it does
// not fall through to some "malformed" branch), so nothing downstream ever
// saw the attempt. A marker written in the SAME documented shape
// FINDING-DEGRADED already uses (id, separator, prose) — e.g. `[FINDING-HIGH:
// WG5-238-001 — <a 300-char sentence>]` — has real id-shaped content
// immediately after the colon, but the closing `]` sits past the 200-char
// cap, so the well-formed regex never matches here and the id was
// (incorrectly) claimed to be undroppable. It was silently dropped: neither
// opened nor reported as malformed, and `checkNoOpenHighFindings` returned
// clean. The old sentence this replaces ("a real id can never be hidden ...
// by simply making it long") stated the INTENT, not what the code measurably
// did — the LONGFORM_ATTEMPT_RE discriminator below is what actually makes
// that sentence true, independently of whether a closing `]` was ever
// found. (TASK-238 closing round: the discriminator no longer requires this
// example's trailing separator either — see isLikelyMarkerAttempt's own
// doc comment for the two residual bands that requirement still missed.)
export const FINDING_ID_MAX_LEN = 40;
const FINDING_MARKER_SCAN_CAP = 200;
// FINDING-DEGRADED's bracket carries a justification sentence after the id
// (see DEGRADED_SEPARATOR_RE below), so it needs more room than the bare-id
// markers above — still bounded, for the same runaway-prose reason. Same
// WG5-238-001 qualifier applies: this bounds only the well-formed fast path,
// not whether an attempt past this cap gets reported (LONGFORM_RE below
// covers that regardless of which of the three marker types is involved).
const FINDING_DEGRADED_SCAN_CAP = 500;

/**
 * TASK-238 — true iff `raw` (after trimming) has "id shape": non-empty, no
 * whitespace of any kind (spaces or newlines — CU3), and at most
 * FINDING_ID_MAX_LEN chars (CU3's "excede el tope de longitud" path). A
 * legitimate id like "WG2-234-001" or "WG-H-050" always passes (CU1/CU4).
 * This predicate alone only governs the WELL-FORMED fast path
 * (FINDING_HIGH_RE/FINDING_RESOLVED_RE/FINDING_DEGRADED_RE); see
 * LONGFORM_RE below (WG5-238-001) for what catches an id-shaped attempt
 * whose surrounding bracket never closes within the scan cap — the case
 * this predicate cannot see by itself, because a regex that requires a `]`
 * within N chars simply fails to match past N, it does not hand control to
 * this function at all.
 */
function isValidFindingId(raw) {
  const id = String(raw).trim();
  return id.length > 0 && id.length <= FINDING_ID_MAX_LEN && !/\s/.test(id);
}

const FINDING_HIGH_RE = new RegExp(`\\[FINDING-HIGH:\\s*([^\\]]{1,${FINDING_MARKER_SCAN_CAP}})\\]`, 'gi');
const FINDING_RESOLVED_RE = new RegExp(`\\[FINDING-RESOLVED:\\s*([^\\]]{1,${FINDING_MARKER_SCAN_CAP}})\\]`, 'gi');
// NAMED LIMIT (THIRD wargaming pass, 2026-09-17, WG3 medium/low list) — a
// `[FINDING-RESOLVED: <id>]` marker written inside a NEGATING sentence
// ("Todavia NO corresponde poner [FINDING-RESOLVED: R-1]; el bug sigue
// vivo.") still resolves the finding, because the marker is live prose (not
// quoted/fenced) exactly like a genuine resolution would be. Evaluated and
// NOT fixed this round: a cheap "look for a negation word near the marker"
// heuristic was considered and rejected on the same false-positive risk the
// blockQuotedAndFencedSpans doc comment already flags for the wargaming
// marker — "no" and "todavia no" appear constantly in legitimate prose that
// is NOT negating the marker itself ("Se resolvio, no queda nada
// pendiente. [FINDING-RESOLVED: R-1]" must NOT be treated as negated). A
// correct fix needs real negation-scope parsing, not a keyword window, and
// is out of scope for this ticket's surface. Left as a named, open gap for a
// future ticket, not resolved in silence.
// The whole marker body is captured, then split on the FIRST em-dash (or a
// spaced hyphen) inside it. Matching the id with a "no dash" character class
// instead would truncate every realistic id — "WG-H-005" and "R-1" both carry
// hyphens — and quietly register the degradation against the wrong id, which
// is worse than not registering it at all.
// TASK-238 — bounded the same way as FINDING_HIGH_RE/FINDING_RESOLVED_RE
// above (see that block's comment), but with FINDING_DEGRADED_SCAN_CAP
// instead of FINDING_MARKER_SCAN_CAP since this bracket also carries a
// justification sentence after the id/separator — the ID portion (before
// the separator, sliced out below) is still validated against
// FINDING_ID_MAX_LEN via isValidFindingId, unaffected by how long the
// justification text is.
const FINDING_DEGRADED_RE = new RegExp(`\\[FINDING-DEGRADED:\\s*([^\\]]{0,${FINDING_DEGRADED_SCAN_CAP}})\\]`, 'gi');
const DEGRADED_SEPARATOR_RE = /—|\s-\s/;

// WG5-238-001 (FIFTH wargaming pass, 2026-09-17) — the discriminator that
// makes "no length band can silently discard an attempted marker" actually
// true. It does NOT depend on ever finding a closing `]`.
//
// TASK-238 (closing round, 2026-09-17) — the ORIGINAL version of this
// discriminator (removed here, see git history) additionally required the
// DOCUMENTED separator (an em-dash, or a spaced hyphen) to appear right
// after the id-shaped token, on the theory that "id + separator + prose" was
// the only realistic longform-attempt shape. Measured against the real,
// LIVE code in this tree: that requirement left three bands silently
// undetected — neither opened as a finding nor reported as malformed, the
// ticket closing clean regardless:
//   - a bare id-shaped/over-length token with NO separator and NO `]`
//     within the scan cap at all (e.g. a 250-char unbroken run);
//   - a short id followed by ordinary prose with no separator (e.g.
//     "[FINDING-HIGH: WG-1 palabra palabra ... ]", `]` past the cap);
//   - the same shapes when the bracket never closes at all.
// FIXED by dropping the separator requirement and matching on the FIRST
// whitespace/`]`-delimited token alone: the marker header, then either (a)
// the token has "id shape with an internal separator"
// (ID_SHAPE_WITH_SEPARATOR_RE below — the charset every real id in this
// repo's corpus already uses, e.g. "WG-H-050", "WG2-234-001") or (b) the
// token is an unbroken non-whitespace run longer than FINDING_ID_MAX_LEN
// (an id-shaped attempt that simply forgot internal separators, or runaway
// prose typed with no spaces at all — either way, too long to be a real id
// and too id-shaped-by-absence-of-spaces to be ordinary prose). Neither
// condition depends on a closing `]` or a following separator.
//
// Measured against every real `[FINDING-...` occurrence in this repo's own
// tasks/ corpus (44 total, all five already-closed tickets: TASK-233
// through TASK-237, plus TASK-234's own history): 42 classify as an attempt
// under this discriminator and exactly 2 as prose — both are the real
// TASK-234 offset-3213 case ("aparece en EXACTAMENTE...", and its later
// all-caps restatement "APARECE EN EXACTAMENTE..." in a different comment),
// whose first token is an ordinary word with no internal separator and well
// under the length cap — CU2 (this ticket's own approved case) stays silent
// on exactly the text it must stay silent on, and no real marker anywhere on
// the live board changes classification.
const ID_SHAPE_WITH_SEPARATOR_RE = /^[A-Za-z0-9]+(?:[-._/][A-Za-z0-9]+)+$/;

function isLikelyMarkerAttempt(token) {
  return ID_SHAPE_WITH_SEPARATOR_RE.test(token) || token.length > FINDING_ID_MAX_LEN;
}

const LONGFORM_ATTEMPT_RE = new RegExp('\\[FINDING-(HIGH|RESOLVED|DEGRADED):\\s*([^\\s\\]]+)', 'gi');

// WG5-238-004 (FIFTH wargaming pass, 2026-09-17) — U+2011 NON-BREAKING HYPHEN
// inside the literal marker keyword ("FINDING‑HIGH") defeats every regex
// above, which all hard-code an ASCII hyphen: the marker never matches at
// all, and nothing downstream ever sees it, not even as "malformed" (no
// signal whatsoever). Normalizing this ONE specific lookalike to ASCII
// hyphen before scanning closes the named reproduction without touching the
// separator vocabulary those regexes already parse on purpose (U+2014 EM
// DASH is DEGRADED_SEPARATOR_RE's own separator character and must not be
// folded into this — see that regex above). Scoped narrowly to the one
// lookalike actually reproduced; a broader dash-confusable sweep (en dash,
// figure dash, etc. inside the keyword) is a named, open residual, not fixed
// here.
const DASH_LOOKALIKE_RE = /‑/g;

/**
 * WG5-238-003 (FIFTH wargaming pass, 2026-09-17) — an id with an invisible
 * Unicode glyph (e.g. a zero-width space, which is not `\s` in JS and so
 * passed isValidFindingId's whitespace check unchanged) opened a finding
 * that a visually-identical `[FINDING-RESOLVED: <id>]` WITHOUT the invisible
 * glyph could never close — the Set-based open/closed comparison is exact
 * string equality, and the error message showed both ids looking identical
 * to a human reading it. Normalizing every id through the SAME
 * IGNORABLE_OR_BLANK_RE mechanism the delivery-body parser already uses
 * (see that constant's doc comment further below) before it enters the
 * opened/closed sets means an id and its invisible-glyph-padded twin always
 * normalize to the same string, so a plain-text resolution/degradation can
 * always close a finding opened with (or without) the padding, symmetrically
 * either direction.
 */
function normalizeFindingId(raw) {
  return String(raw).trim().normalize('NFD').replace(IGNORABLE_OR_BLANK_RE, '').toUpperCase();
}

/**
 * WG5-238-002 (FIFTH wargaming pass, 2026-09-17) — a FINDING-DEGRADED
 * justification made of nothing but Unicode's own "invisible" glyphs
 * (BRAILLE PATTERN BLANK U+2800, HANGUL FILLER U+3164 — both reachable
 * through the supported `append_comment` API, confirmed neither is stripped
 * by its sanitizer) or nothing but the separator's own dash vocabulary (a
 * bare "-" left over once DEGRADED_SEPARATOR_RE consumes the real
 * separator, e.g. `[FINDING-DEGRADED: id — -]`) closed a HIGH finding with
 * no human-readable justification at all — indistinguishable from writing
 * nothing, which WG-H-005 already requires to NOT count as closed. Reuses
 * IGNORABLE_OR_BLANK_RE (the same delegated-to-Unicode mechanism
 * normalizeFindingId above and normalizeDeliveryText below both use, not a
 * new hand-rolled denylist) for the general "Unicode says this renders with
 * no visible glyph" class, plus a narrow strip of the literal separator
 * characters (a dash is not Default_Ignorable and has a real glyph, but it
 * is this same regex block's own separator punctuation, not prose, so a
 * remainder made of nothing else is still not a justification).
 */
function hasVisibleJustification(text) {
  return String(text)
    .normalize('NFD')
    .replace(IGNORABLE_OR_BLANK_RE, '')
    .replace(/[-—\s]+/g, '')
    .length > 0;
}

/**
 * R-3 (reviewer finding, TASK-238 round) — the malformed-marker preview used
 * to append "..." unconditionally, even when the id was short enough to
 * never have been truncated at all. Only append it when slicing actually
 * dropped characters.
 */
function truncatePreview(raw) {
  const trimmed = String(raw).trim();
  const sliced = trimmed.slice(0, FINDING_ID_MAX_LEN);
  return sliced + (trimmed.length > FINDING_ID_MAX_LEN ? '...' : '');
}

// WG2-M-05 (wargaming 2026-09-17) — a finding marker mentioned inside a
// fenced code block, an inline backtick span, or a double-quoted string is a
// MENTION, not an assertion, and must not open or close a finding.
// Reproduction before this fix: `[FINDING-HIGH: WG-H-050] bug real sin
// arreglar`, followed by a process-reminder comment reading `Recordatorio:
// NUNCA escribas "[FINDING-RESOLVED: WG-H-050]" sin haber arreglado el bug.`
// closed WG-H-050 — the resolution marker was quoted, describing what NOT to
// write, and the scan counted it anyway. Blanking these spans out (same
// length, so no other match's index shifts) before scanning, rather than
// special-casing each of the three regexes below, is the same shape of fix
// WG2-M-03 needed for the wargaming marker, generalized: a marker only
// counts when it appears as live prose, not quoted/fenced text ABOUT the
// convention. Deliberately simple (no escape-sequence handling in the
// double-quote regex, and quotes cannot span a newline) — comments here are
// agent-authored prose, not a language needing string escaping; the
// conservative failure mode is a real marker someone chose to needlessly
// quote losing the block-until-resolved protection, never the reverse.
const FENCED_CODE_BLOCK_RE = /```[\s\S]*?```/g;
const BACKTICK_SPAN_RE = /`[^`\n]*`/g;
const DOUBLE_QUOTED_SPAN_RE = /"[^"\n]*"/g;

function blankQuotedAndFencedSpans(text) {
  return text
    .replace(FENCED_CODE_BLOCK_RE, (m) => ' '.repeat(m.length))
    .replace(BACKTICK_SPAN_RE, (m) => ' '.repeat(m.length))
    .replace(DOUBLE_QUOTED_SPAN_RE, (m) => ' '.repeat(m.length));
}

/**
 * TASK-240 (WG-3) — the ONE parser of finding-marker state. checkNoOpenHighFindings (below) and
 * src/wargame-wrecker.js's ticket-history lookup both read markers through this function, so a
 * marker the close guard counts (live prose, U+2011-normalized keyword, invisible-glyph-normalized
 * id, DEGRADED only with a visible justification) is counted identically by the record builder,
 * and a quoted/fenced mention counts for neither. Ids are normalized (normalizeFindingId).
 * Returns { opened, closed, resolved, degraded, malformed }: `closed` = resolved OR degraded.
 */
export function collectFindingMarkerState(comments) {
  const allText = comments
    .map((c) => blankQuotedAndFencedSpans(String((c && c.body) || '')).replace(DASH_LOOKALIKE_RE, '-'))
    .join('\n');

  const opened = new Set();
  const closed = new Set();
  const resolved = new Set(); // closed by a live RESOLVED marker
  const degraded = new Set(); // closed by a live DEGRADED marker with a visible justification
  // TASK-238 — every attempt whose id fails isValidFindingId lands here
  // instead of being silently folded into `opened`/`closed`; a preview
  // (truncatePreview — R-3: only ellipsized when actually truncated) is
  // kept so the thrown message names what could not be parsed, not just
  // that something couldn't.
  const malformed = [];

  for (const m of allText.matchAll(FINDING_HIGH_RE)) {
    const raw = m[1];
    if (isValidFindingId(raw)) {
      opened.add(normalizeFindingId(raw));
    } else {
      malformed.push(`FINDING-HIGH: "${truncatePreview(raw)}"`);
    }
  }
  for (const m of allText.matchAll(FINDING_RESOLVED_RE)) {
    const raw = m[1];
    if (isValidFindingId(raw)) {
      closed.add(normalizeFindingId(raw));
      resolved.add(normalizeFindingId(raw));
    } else {
      malformed.push(`FINDING-RESOLVED: "${truncatePreview(raw)}"`);
    }
  }
  for (const m of allText.matchAll(FINDING_DEGRADED_RE)) {
    const inner = m[1] || '';
    const sep = inner.search(DEGRADED_SEPARATOR_RE);
    if (sep === -1) continue; // no separator at all: no justification recorded (unchanged pre-TASK-238 behavior)
    const rawId = inner.slice(0, sep);
    if (!isValidFindingId(rawId)) {
      malformed.push(`FINDING-DEGRADED: "${truncatePreview(rawId)}"`);
      continue;
    }
    const justification = inner.slice(sep).replace(DEGRADED_SEPARATOR_RE, '').trim();
    // WG5-238-002 — a justification made of nothing but invisible glyphs or
    // nothing but the separator's own dash vocabulary does not count as
    // "recorded" (see hasVisibleJustification's doc comment above).
    if (rawId.trim() !== '' && hasVisibleJustification(justification)) {
      closed.add(normalizeFindingId(rawId));
      degraded.add(normalizeFindingId(rawId));
    }
  }

  // WG5-238-001 / TASK-238 closing round — an id-shaped (or over-length)
  // attempt whose closing `]` never falls within the well-formed regexes'
  // scan cap, and does not depend on a documented separator ever appearing
  // (LONGFORM_ATTEMPT_RE's doc comment above has the full rationale and the
  // real-corpus measurement). Only counted when the well-formed regexes
  // above did NOT already match at the same starting index, so a marker
  // already opened/closed/malformed through the fast path is never
  // double-reported.
  const wellFormedStarts = new Set();
  for (const re of [FINDING_HIGH_RE, FINDING_RESOLVED_RE, FINDING_DEGRADED_RE]) {
    for (const m of allText.matchAll(re)) wellFormedStarts.add(m.index);
  }
  for (const m of allText.matchAll(LONGFORM_ATTEMPT_RE)) {
    if (wellFormedStarts.has(m.index)) continue;
    const token = m[2];
    if (!isLikelyMarkerAttempt(token)) continue; // ordinary prose (CU2) — stays silent, by design
    malformed.push(`FINDING-${m[1].toUpperCase()}: "${truncatePreview(token)}" (no se encontro "]" de cierre dentro del scan cap, o sin el separador documentado, pero el primer token tiene forma de id)`);
  }

  return { opened, closed, resolved, degraded, malformed };
}
