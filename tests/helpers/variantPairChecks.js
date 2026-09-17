// tests/helpers/variantPairChecks.js
// TASK-237 (second loop-back, WG3-237-001) — MECHANISM A of two complementary sensors.
//
// See tests/helpers/agentInstructionGuardChecks.js's file-header comment for what the OTHER
// sensor (mechanism B, a contradiction scanner) covers and why the two must never be merged.
// This module covers what B structurally cannot: it compares the SAME conceptual pair of
// instruction files (a framework variant vs its differently-named -current-project counterpart)
// and fails when content was ADDED to or REMOVED from only one side, whatever the markdown
// heading level or section structure it landed under.
//
// Why not a heading-inventory diff (the previous WG2-237-001 fix, now proven insufficient)?
// Because a heading-level check only sees section TITLES — content inserted under an EXISTING
// heading, or under a duplicated heading, or as a bare paragraph with no heading at all, never
// shows up. WG3-237-001 demonstrated six such evasions, all green under the old check.
//
// Why not a byte-identical diff? Because these pairs are RETARGETED ON PURPOSE per repo (the
// skill's own name, "framework repo" vs "this project", cross-references to the sibling file) —
// see NAME_PAIRS in tests/mirror-pairs-discovery.spec.js for the concrete substitutions. A byte
// diff would be red on every legitimate repo the moment anyone reworded a sentence.
//
// The approach: split both files into SENTENCE-SIZED chunks (paragraph/bullet-aware), apply a
// small set of per-pair text substitutions that canonicalize the KNOWN retargeting (skill names,
// "repo" vs "project" wording, sibling-file pointers), then, for every chunk on one side, look
// for a chunk on the other side with high enough word-overlap (Jaccard similarity) to count as
// "the same sentence, reworded". A chunk with NO good match on the other side is flagged as a
// one-sided ADDITION (if it's new) or a one-sided REMOVAL (seen from the other file's
// perspective) — exactly the injected-content shape used in all six WG3-237-001 evasions,
// regardless of which heading level or section it landed under, because sentence-level matching
// does not look at headings at all.
//
// A flagged chunk is tolerated ONLY if it is covered by a NAMED, JUSTIFIED exception recorded in
// the pair's `oneSidedChunks` list (see tests/mirror-pairs-discovery.spec.js) — an unnamed
// mismatch is always a failure, never silently absorbed by the similarity threshold.
//
// Threshold note: 0.55 Jaccard on lowercase \w+ tokens was chosen by running this exact module
// against the seven real pairs in this repo (three SKILL.md pairs + four references/ pairs) and
// confirming zero uncovered mismatches on the CURRENT, un-injected content — see this ticket's
// hand-off for the measured run. Raising the threshold would re-admit small-wording-tweak
// evasions; lowering it would false-positive on legitimate per-repo prose retouches.

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'is', 'it', 'this', 'that', 'for', 'on', 'with',
  'as', 'by', 'be', 'are', 'at', 'not', 'no', 'if', 'its',
]);

/** Apply an ordered list of [pattern, replacement] substitutions to canonicalize known retargeting. */
export function normalizeVariantText(text, substitutions = []) {
  let out = text;
  for (const [pattern, replacement] of substitutions) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * Split markdown text into sentence-ish chunks: blank-line-delimited blocks, further split on
 * bullet boundaries and on sentence-ending punctuation. Headings (`#`/`##`/...) become their own
 * chunk with the hashes stripped, so a heading is compared as content too, not ignored.
 */
export function chunksOf(text) {
  const blocks = text.split(/\n\s*\n/);
  const chunks = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    // Bullets: each `- `/`* ` line (plus its non-bulleted wrapped continuation lines) is its own item.
    let current = [];
    const items = [];
    for (const line of lines) {
      if (/^[-*]\s+/.test(line)) {
        if (current.length) items.push(current.join(' '));
        current = [line.replace(/^[-*]\s+/, '')];
      } else if (/^#{1,6}\s+/.test(line)) {
        if (current.length) items.push(current.join(' '));
        items.push(line.replace(/^#{1,6}\s+/, ''));
        current = [];
      } else {
        current.push(line);
      }
    }
    if (current.length) items.push(current.join(' '));
    for (const item of items) {
      // Split on sentence-ending punctuation AND on em-dash-delimited clauses. The em-dash split
      // matters for red-green-verified reasons (TASK-237 second loop-back, WG3-237-001 evasion
      // (e)): a poison clause spliced into the MIDDLE of an existing long, legitimate sentence
      // barely moves a whole-sentence Jaccard score when the surrounding sentence is long -- the
      // similarity check missed it in manual verification before this split was added. Splitting
      // on em-dashes turns the injected clause into its own short chunk, which has near-zero word
      // overlap with anything on the other side and is flagged correctly.
      //
      // The sentence-end split tolerates an optional `**`/`__` bold-close marker between the
      // punctuation and the whitespace (`'safe'`.**` vs `'safe'`** (TASK-140).`) via a
      // variable-length lookbehind -- without this, a real, legitimate bold/punctuation-ordering
      // difference between two variants shifts the chunk boundary on only one side and produces a
      // false positive (this repo has exactly one such case, in the assimilate pair's Default-deny
      // clause -- verified while tuning this file).
      const sentences = item
        .split(/(?<=[.!?:]\*{0,2})\s+(?=[A-Z0-9`*_(])/)
        .flatMap((s) => s.split(/\s+\u2014\s+/));
      for (const s of sentences) {
        const trimmed = s.trim();
        if (trimmed.length >= 8) chunks.push(trimmed);
      }
    }
  }
  return chunks;
}

function wordsOf(chunk) {
  return new Set(
    chunk
      .toLowerCase()
      .replace(/[`*_#>]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1 && !STOPWORDS.has(w)),
  );
}

/** Jaccard similarity of two chunks' word sets. */
export function chunkSimilarity(a, b) {
  const wa = wordsOf(a);
  const wb = wordsOf(b);
  if (wa.size === 0 && wb.size === 0) return 1;
  let intersection = 0;
  for (const w of wa) if (wb.has(w)) intersection++;
  const union = wa.size + wb.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

/** Chunks in `from` with no chunk in `against` reaching `threshold` similarity. */
export function unmatchedChunks(from, against, threshold) {
  const unmatched = [];
  for (const chunk of from) {
    let best = 0;
    for (const other of against) {
      const sim = chunkSimilarity(chunk, other);
      if (sim > best) best = sim;
      if (best >= threshold) break;
    }
    if (best < threshold) unmatched.push({ chunk, best });
  }
  return unmatched;
}

/**
 * Compare two variant files at sentence granularity. Returns the one-sided chunks on each side
 * that are NOT covered by `oneSidedChunks` (an array of substrings; a chunk is "covered" if it
 * includes one of these substrings), plus coverage stats for reporting.
 */
export function checkVariantParity({
  frameworkText,
  consumerText,
  substitutions = [],
  threshold = 0.55,
  oneSidedChunks = [],
}) {
  const fChunks = chunksOf(normalizeVariantText(frameworkText, substitutions));
  const cChunks = chunksOf(normalizeVariantText(consumerText, substitutions));
  const isExcepted = (chunk) => oneSidedChunks.some((needle) => chunk.includes(needle));

  const frameworkOnly = unmatchedChunks(fChunks, cChunks, threshold)
    .filter(({ chunk }) => !isExcepted(chunk));
  const consumerOnly = unmatchedChunks(cChunks, fChunks, threshold)
    .filter(({ chunk }) => !isExcepted(chunk));

  return {
    frameworkOnly,
    consumerOnly,
    frameworkChunkCount: fChunks.length,
    consumerChunkCount: cChunks.length,
  };
}
