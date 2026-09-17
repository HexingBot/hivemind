// tests/helpers/policyPropagationChecks.js
// TASK-233 (WG-H4-001) — pure, path-agnostic checks for whether a
// consumer-shipped instruction surface (agents/, skills/, commands/) still
// carries the retired TDD-gate policy, or is missing the two 2026-09-16
// gates (human-approval hard stop, wargaming as final verification).
//
// Deliberately extracted from the spec file so the SAME logic can be run
// against files that are NOT this repo's: tests/policy-propagation-doc-locks.spec.js
// runs it over the real committed repo files, and an out-of-repo mutant caller
// runs it over deliberately-broken /tmp copies to prove each check can actually
// fail (see the TASK-233 hand-off for the mutant table; the reviewer exercised
// this path independently). Enabling that out-of-repo caller — not a second
// committed import — is what earns this file existing as its own module rather
// than living inline in the spec, where the checks could only ever be pointed
// at the repo that makes them pass.
//
// Every content-CHECKING function here is pure: it takes a string (file
// content) and returns a plain result. The one exception is
// `enumerateConsumerSurfaces(repoRoot)` below (added in the wargaming
// loop-back round, HIGH-2), which reads directory listings — a read-only fs
// walk, never a write — because HIGH-2 was precisely that a hand-maintained
// path LIST (no glob) silently went stale as new surfaces shipped. It still
// takes its root as an explicit argument (no repo-root resolution baked in),
// so the same out-of-repo mutant caller can point it at a /tmp copy tree.
//
// ===========================================================================
// WARGAMING LOOP-BACK ROUND (2026-09-17) — findings fixed here, and the ones
// deliberately left as documented limitations rather than "fixed":
// ===========================================================================
//   HIGH-1  → the retired-policy phrasing this file was meant to catch was
//             found LIVE on skills/impl-block-tasks/SKILL.md (both copies).
//             Fixed on the SKILL.md side (not this file); see the ticket
//             hand-off's grep before/after.
//   HIGH-2  → CONSUMER_SURFACES was a hardcoded 5-file list; 25 of ~30
//             shipped surfaces were unscanned. Fixed: `enumerateConsumerSurfaces`
//             below enumerates agents/*.md, commands/*.md, skills/*/SKILL.md
//             from disk and throws (fails loudly, TASK-192 empty-result
//             contract) on zero results, instead of silently reporting green.
//             The forbidden-phrase scan now runs over every enumerated
//             surface; the POSITIVE gates stay pinned to the specific files
//             they apply to (a positive requirement is inherently per-file).
//   HIGH-3  → commands/loop.md was in the old hardcoded list but had no
//             POSITIVE lock, only the (surface-wide) forbidden scan — so
//             deleting its two 2026-09-16 gates wholesale stayed green.
//             Fixed: `hasLoopMdGates` below.
//   MEDIUM-1 → 16 of 24 adversary paraphrases of "absent means tdd" survived
//             the 5 frozen literal regexes (bare synonyms, an enum
//             re-addition, Spanish). Fixed: `findTddRevivalMatches` below is
//             a `\btdd\b`-anchored, character-windowed scan with an EXPLICIT,
//             documented allowlist for legitimate past-tense/historical
//             prose (see TDD_ALLOWLIST_STEMS / TDD_PRESCRIPTIVE_CUES) plus
//             three additional literal patterns for the 3 paraphrases that
//             don't even mention "tdd" (see FORBIDDEN_PATTERNS' last three
//             entries).
//   MEDIUM-2 → `hasReviewerWargamingGate`'s ">= 2 occurrences of 'is a HIGH
//             finding'" counting rule was satisfiable by an unrelated
//             OBSERVABILITY bullet. Fixed: it now matches the two SPECIFIC
//             rule sentences by their own wording, not a count.
//   MEDIUM-3 → none of the positive gates excluded fenced code blocks or
//             HTML comments, so a whole refusal/wargaming section wrapped in
//             a "POLITICA VIEJA" fence or an HTML comment still read as
//             PRESENT. Fixed for the POSITIVE gates only: `stripFencesAndComments`
//             runs before every positive-gate check below EXCEPT
//             `hasLoopMdGates`, which strips HTML comments only
//             (`stripHtmlCommentsOnly`) — commands/loop.md's own two gates
//             legitimately live INSIDE a real fenced pseudocode block (the
//             "Step 2 — Loop until done" control-flow listing), so the same
//             triple-backtick strip would blind that one check to its own
//             subject matter. See that function's own comment.
//             ASYMMETRY, DELIBERATE: the FORBIDDEN scan (`findForbiddenMatches`,
//             `findTddRevivalMatches`) does NOT strip fences/comments — a
//             forbidden phrase quoted inside a fence, or inside a "never do
//             this" HTML comment, still trips it (confirmed against the
//             adversary's F25/F26/F27 mutants). That over-firing is the SAFE
//             direction for a forbidden-phrase scan (a false-positive here
//             just means someone has to move a legitimate quoted example out
//             of a shipped surface into a non-shipped doc, which is a
//             reasonable ask); stripping fences from the forbidden scan would
//             instead open a hole where the retired policy could be shipped
//             for real as long as it sat inside a fence. Do not "fix" this
//             asymmetry without re-reading this paragraph.
//   MEDIUM-4 → every check here is keyword-shaped, so appending an exemption
//             clause ("— except in loop mode, where you dispatch without any
//             approval") to a gate keeps every check green: the checks detect
//             DELETION and (for the gates with position anchors) MISPLACEMENT,
//             never INVERSION/negation of a gate's meaning. This is a
//             DELIBERATE, DOCUMENTED LIMITATION, not an oversight — general
//             negation detection via regex/keyword matching is not reliably
//             achievable and attempting it produces false reds (see the
//             ticket hand-off for the rejected approaches). A reader must
//             NOT treat a green result from this file as proof that a gate
//             means what it says — only that its required phrasing has not
//             been deleted or moved out of position.
//   MEDIUM-5 → this file freezes a 2026-09-16 snapshot of the policy. A
//             FUTURE change to CLAUDE.md's Workflow/Verification-flow section
//             is undetectable here until a human hand-updates the forbidden/
//             required phrase lists below. This is a DELIBERATE, DOCUMENTED
//             LIMITATION (a CLAUDE.md-coupled detector is a materially larger
//             design out of scope for this round) — not a gap silently
//             assumed closed.
//   LOW-1   → AC5's "never touches tasks/" self-check (in the spec file) is a
//             text-pattern self-assertion, evadable via aliased imports,
//             computed strings, or other fs write functions
//             (`writeFile`/`rmSync`/etc.) it doesn't name. The REAL guarantee
//             is structural: this module has no write call anywhere in it.
//             Left as-is (not strengthened) — a text-pattern self-check
//             calling itself "the guarantee" would be worse than one that
//             is honestly a best-effort net; the comment in the spec file is
//             the place that limitation is now written down, not claimed away.
//   LOW-2   → two exact-string anchors were brittle to harmless edits: (a)
//             the developer-refusal window was exactly 200 chars, so >200
//             chars of benign prose between the two refusal phrases false-
//             reds; widened to 500. (b) `hasSkillDispatchHardStop`'s
//             `step1Idx` anchor was the literal string '1. **Fetch ticket.**',
//             so renaming it to '1. **Fetch the ticket.**' false-reds; loosened
//             to a small regex tolerant of that one wording variant.

// ---------------------------------------------------------------------------
// Consumer-surface enumeration (HIGH-2) — read from disk, not a hand-kept
// list. Read-only: `existsSync`/`readdirSync` only, no write call anywhere.
// ---------------------------------------------------------------------------
import { existsSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// ---------------------------------------------------------------------------
// WARGAMING LOOP-BACK, 3rd PASS (2026-09-17, WG2-233-001 + two MEDIUM edges)
// — findings fixed in THIS round, layered on top of the 2026-09-17 round
// documented immediately below:
// ---------------------------------------------------------------------------
//   HIGH (WG2-233-001) → the retired-doctrine phrase this file exists to
//             catch ("phrased so a test-first (red-green) test can assert
//             it") had NO pattern at all — neither "test-first" nor
//             "red-green" appears in any of the 8 forbidden literals, so a
//             verbatim restoration of that line stayed green. Fixed: a new
//             literal `test-first-red-green-outcome-phrasing` below, scoped
//             to the bare hyphenated token `test-first` ONLY (see that
//             pattern's own comment for why "red-green" itself is
//             deliberately NOT part of the trigger — that word is legitimate,
//             live policy). Second half of the same finding: the dangling
//             `.claude/shared/TDD.md` pointer was only reachable through
//             `findTddRevivalMatches`'s allowlist-gated scan, so planting it
//             next to unrelated "TDD is eliminated" prose silenced it by
//             adjacency. Fixed: `tdd-md-dangling-pointer` below is a plain
//             literal in FORBIDDEN_PATTERNS, unconditional, with no allowlist
//             to be silenced by.
//   MEDIUM (surface count) → `enumerateConsumerSurfaces` only read ONE level
//             (agents/*.md, commands/*.md, skills/*/SKILL.md) — 30 of the 37
//             real shipped `.md` surfaces, missing every `references/*.md`
//             (7 real files) and any nested skill directory. Fixed: rewritten
//             below as a recursive walk of all three roots, collecting every
//             `.md` file at any depth.
//   MEDIUM (loop.md anchor) → `hasLoopMdGates`'s phrase-position checks ran
//             over the WHOLE file, so an adversary could paste a
//             "historical appendix (derogado, NO rige)" block containing the
//             four required phrases, in order, anywhere BEFORE the real
//             step list, while gutting the real steps inside the Step 2
//             fence — `text.indexOf` finds the decoy occurrences first and
//             the ordering check is satisfied by them. Fixed: the check now
//             extracts ONLY the fenced pseudocode block that follows the
//             "### Step 2 — Loop until done" heading (`extractLoopStepsBlock`
//             below) and searches exclusively inside that span — content
//             placed anywhere else in the file, decoy or real, is invisible
//             to it.
//   Measured, NOT worsened (false positives already present before this
//   round — see the ticket hand-off for the exact before/after counts):
//     - `write-tests-first-instruction` used to fire on a correct
//       PROHIBITION ("Do not write the tests first under any tier."). Fixed
//       with a negative lookbehind for the negation cue immediately before
//       "write" — see that pattern's own comment.
//     - `findTddRevivalMatches` used to fire on two legitimate retrospective
//       sentences that name "tdd" alongside a prescriptive-sounding cue word
//       ("tests-after", "default") purely by co-occurrence, not because they
//       instruct defaulting to tdd. Fixed by widening
//       TDD_ALLOWLIST_STEMS — see the two new stems' own comments.
// ---------------------------------------------------------------------------

/**
 * Recursively collects every `.md` file under `dir`, returning paths
 * relative to `repoRoot` in posix style (forward slashes), so the same
 * output shape works on any OS. Read-only (`readdirSync` only).
 */
function walkMdFiles(dir, repoRoot) {
  const results = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkMdFiles(abs, repoRoot));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(relative(repoRoot, abs).split(sep).join('/'));
    }
  }
  return results;
}

/**
 * Enumerates every shipped instruction surface under `repoRoot`: every
 * `.md` file anywhere under `agents/`, `commands/`, or `skills/` — at ANY
 * depth, not just the top level. This is what makes a nested skill
 * directory (`skills/<group>/<nested>/SKILL.md`) and a progressive-
 * disclosure `references/*.md` file (7 real ones exist under `skills/` as
 * of the 2026-09-17 round: hive-adversarial-improve-current-project x2,
 * hive-self-improve-current-project x2, mcp-server x3) visible to the scan
 * instead of silently skipped. Returns paths sorted for deterministic
 * output.
 *
 * TASK-192 empty-result contract: a genuinely empty repo (no agents/,
 * commands/, or skills/ at all) is not a plausible state for this project —
 * zero surfaces found means the enumeration is broken (wrong repoRoot, a
 * moved directory), not that there is legitimately nothing to scan. Throws
 * rather than returning `[]`, so this reads as a gate FAILURE, never a
 * silent green.
 */
export function enumerateConsumerSurfaces(repoRoot) {
  const surfaces = [
    ...walkMdFiles(join(repoRoot, 'agents'), repoRoot),
    ...walkMdFiles(join(repoRoot, 'commands'), repoRoot),
    ...walkMdFiles(join(repoRoot, 'skills'), repoRoot),
  ];

  if (surfaces.length === 0) {
    throw new Error(
      'enumerateConsumerSurfaces found ZERO shipped instruction surfaces under agents/, ' +
        'commands/, skills/ at repoRoot=' +
        repoRoot +
        ' — this is almost certainly a broken enumeration (wrong repoRoot, a moved or ' +
        'renamed directory), not a legitimate empty state. Failing loudly per the TASK-192 ' +
        'empty-result contract rather than reporting an unqualified, vacuous "no forbidden ' +
        'phrases found" success.',
    );
  }

  return surfaces.sort();
}

// ---------------------------------------------------------------------------
// Fence/HTML-comment stripping — POSITIVE gates only. See MEDIUM-3 above for
// why the forbidden scan deliberately does NOT use this.
// ---------------------------------------------------------------------------
function stripFencesAndComments(text) {
  return text.replace(/```[\s\S]*?```/g, '').replace(/<!--[\s\S]*?-->/g, '');
}

// commands/loop.md's own two gates (step 3's approval STOP, step 6's
// wargaming step) legitimately live INSIDE a fenced pseudocode block (the
// "Step 2 — Loop until done..." control-flow listing) — that fence is real
// content, not a decoy wrapper, so running the same fence-stripping used for
// the other positive gates would blind `hasLoopMdGates` to its own subject
// matter. HTML comments are still stripped (nothing legitimate in this file
// puts either gate inside one); only the triple-backtick strip is skipped
// here, deliberately, and only for this one check.
function stripHtmlCommentsOnly(text) {
  return text.replace(/<!--[\s\S]*?-->/g, '');
}

// ---------------------------------------------------------------------------
// Forbidden phrases — the measured, real wording of the retired tests-first
// gate (git show a45808c:agents/developer.md, the last commit before TASK-212
// retired the `tdd` tier) plus the "absent means tdd" default that survived
// past TASK-212 in the actually-installed stale plugin (confirmed live:
// ~/.claude/plugins/cache/hivemind-marketplace/hivemind/0.22.0/agents/developer.md
// line 16, and its SKILL.md, both still contain it as of 2026-09-16). Each
// pattern is a multi-word phrase, not a bare substring, per the TASK-184/
// TASK-229 substring-collision precedent.
//
// The last three entries (added in the wargaming loop-back round, MEDIUM-1)
// cover paraphrases that do NOT mention "tdd" at all, so `findTddRevivalMatches`
// below — which is anchored on the word "tdd" — structurally cannot catch
// them; they need their own literal patterns.
// ---------------------------------------------------------------------------
export const FORBIDDEN_PATTERNS = [
  {
    name: 'absent-means-tdd',
    re: /absent means[\s`]*tdd\b/i,
    harm:
      'a shipped surface that still defaults an unset verification_tier to the retired `tdd` ' +
      'tier re-legitimizes tests-first as a live, assignable tier for any Developer that reads it',
  },
  {
    name: 'before-writing-any-implementation-code',
    re: /before writing any implementation code/i,
    harm: 'reintroduces a tests-first gate instructing tests be written before any implementation exists',
  },
  {
    name: 'never-write-implementation-before-test-commit',
    re: /never write implementation code before/i,
    harm: 'reintroduces the retired two-commit tests-first discipline as a live instruction',
  },
  {
    name: 'strictly-before-implementation-commit',
    re: /strictly before[\s\S]{0,40}implementation commit/i,
    harm: 'reintroduces the retired test-commit-must-land-first ordering rule',
  },
  {
    name: 'tests-first-step-tdd-tier-only',
    re: /tests-first step \(tdd tier only/i,
    harm: 'reintroduces the retired tdd-tier tests-first step heading as a live section',
  },
  {
    name: 'write-tests-first-instruction',
    // Negative lookbehind added in the 2026-09-17 loop-back round: the bare
    // form used to fire on a correct PROHIBITION too — "Do not write the
    // tests first under any tier." is enunciating the CURRENT policy
    // (TDD eliminated), not reinstating it, but the old unconditional regex
    // could not tell the difference. The lookbehind excludes the exact
    // negation cue word(s) immediately preceding "write" (English + the two
    // Spanish forms this repo actually uses elsewhere); it deliberately does
    // NOT attempt general negation detection anywhere in the sentence — see
    // MEDIUM-4 in this file's 2026-09-16-round header for why that is out of
    // scope. A real instruction like "You must write the tests first" is
    // still caught: "must " is not a negation cue.
    re: /(?<!\b(?:do not|don't|never|avoid|nunca|no debe[sn]?|jamás)\s)\bwrite (the )?tests? first\b/i,
    harm:
      'reintroduces a bare "write the tests first" instruction under a phrasing that does not ' +
      'mention "tdd" at all, evading the tdd-anchored scan below',
  },
  {
    name: 'test-first-red-green-outcome-phrasing',
    // WG2-233-001 (2026-09-17): the mutant that survived the 3rd wargaming
    // pass restored, verbatim, the old task-template line "...phrased so a
    // test-first (red-green) test can assert it" — none of the other 8
    // literals, and none of findTddRevivalMatches (it is `tdd`-anchored,
    // and this sentence never says "tdd"), had any pattern for either
    // "test-first" or "red-green".
    //
    // DELIBERATE SCOPE: this pattern triggers on the bare hyphenated token
    // `test-first` ONLY — it does NOT match "red-green" or "red-green
    // planting" in any form. Those phrases are LIVE, CORRECT policy
    // (agents/developer.md's "Red-green planting" section, required by
    // CLAUDE.md's Testing section): every new test/spec/lock must still be
    // proved able to fail by reverting the fix and confirming red, then
    // restored — that is a practice performed AFTER the implementation
    // exists, not an ordering rule. What is forbidden is "test-FIRST"
    // (write/derive the test before the code exists) — a distinct, retired
    // concept. A blind trigger on "red-green" alone would have gone red on
    // agents/developer.md's OWN compliant "Red-green planting" section and
    // on `agents/reviewer.md`'s "Red-green planting still applies..." line
    // — i.e. it would have broken correct, currently-shipped policy text,
    // which is exactly the outcome this ticket's briefing warned against.
    //
    // Corpus check performed before adding this pattern (2026-09-17): the
    // bare hyphenated token `test-first` (singular, with hyphen) has ZERO
    // legitimate occurrences anywhere under agents/, commands/, skills/, or
    // CLAUDE.md — every live mention of the retired concept uses the plural
    // "tests-first" (e.g. "ni tests-first bajo ningun nombre"), which this
    // pattern does NOT match (`tests-first` does not contain the substring
    // `test-first` — the extra `s` breaks the hyphen adjacency). A plain,
    // unhyphenated "test first" (two words, no hyphen) was deliberately
    // NOT added to this pattern either: `agents/reviewer.md` legitimately
    // contains "...never by ordering the test first" inside a correct
    // negated sentence, so widening the trigger to the unhyphenated form
    // would have reintroduced exactly the false-positive class this round
    // was told to fix, not create a new one.
    re: /\btest-first\b/i,
    harm:
      'reintroduces the retired tests-first task-authoring instruction ("phrase the outcome so a ' +
      'test-first test can assert it"), which tells whoever authors the next task template to ' +
      'write the test before the implementation — the exact ordering CLAUDE.md eliminated',
  },
  {
    name: 'tdd-md-dangling-pointer',
    // WG2-233-001, second half: the pointer to the retired doctrine doc
    // `.claude/shared/TDD.md` was only reachable via findTddRevivalMatches's
    // \btdd\b-anchored, allowlist-gated scan — so planting the pointer next
    // to unrelated "TDD is eliminated" prose silenced it (the allowlist stem
    // /elimin/i matched the nearby legitimate sentence, not the pointer
    // itself, but the window-based check can't tell those apart). This is a
    // plain, unconditional literal instead — no allowlist to be silenced by.
    // `.claude/shared/` only contains MINIMALISM.md and OBSERVABILITY.md
    // (confirmed on disk as of 2026-09-17); TDD.md does not exist, so any
    // surviving pointer to it is dead at best and a retired-doctrine re-read
    // at worst if a stale copy exists anywhere else.
    re: /\.claude\/shared\/TDD\.md/i,
    harm:
      'reinstates a pointer to a tests-first doctrine doc that no longer exists — following it ' +
      'either 404s for the reader or, if a stale copy survives elsewhere, re-teaches retired ' +
      'tests-first doctrine as if it were still authoritative',
  },
  {
    name: 'escribi-tests-primero-instruction',
    re: /escrib[ií] (los? )?tests? primero/i,
    harm:
      'Spanish paraphrase of "write the tests first" — the shipped Developer surface is ' +
      'bilingual (its refusal section is written in Spanish), so an English-only forbidden list ' +
      'leaves this wide open',
  },
  {
    name: 'must-precede-implementation',
    re: /must precede the implementation\b/i,
    harm:
      'reintroduces the retired test-must-land-first ordering rule under a phrasing not anchored ' +
      'to the literal "strictly before implementation commit" pattern above',
  },
];

// ---------------------------------------------------------------------------
// Generic `\btdd\b`-anchored revival scan (MEDIUM-1) — replaces relying on
// `absent-means-tdd` alone to catch every "the tier defaults/reduces/resolves
// to tdd" paraphrase. For every bare "tdd" mention, look at a fixed
// character window around it (empirically sized against this repo's own
// longest wrapped paragraphs — see the ticket hand-off for the measurement)
// and classify:
//   - if the window contains an ALLOWLIST stem (legitimate historical /
//     retrospective prose — "retired", "eliminated", "historical", etc., in
//     English or Spanish), it is NOT a violation, full stop;
//   - otherwise, if the window also contains a PRESCRIPTIVE cue (default,
//     absent, implies, assumed, first, precede, or co-occurring sibling tier
//     names suggesting an enum listing), it IS a violation.
//
// Documented limitation: this is a proximity heuristic, not a parser. A
// pathological adjacency (a real violation planted within ~250 characters of
// an unrelated, legitimate "retired"/"eliminated" mention elsewhere in the
// same paragraph) could mask a true positive. Accepted for a MEDIUM-severity
// fix; see MEDIUM-5 above for the sibling limitation this file already
// documents about staying in sync with CLAUDE.md.
// ---------------------------------------------------------------------------
const TDD_WINDOW_RADIUS = 250;

// Legitimate historical/retrospective context — EXPLICIT and commented, not
// an accident (per the finding's own instruction). Each stem is written as
// the shortest unambiguous fragment so it matches all its inflections
// (English and Spanish) without needing separate entries per tense/gender.
const TDD_ALLOWLIST_STEMS = [
  /retir/i, // retired / retires / retiring / retiró / retiro / retirado
  /elimin/i, // eliminated / eliminates / eliminado / elimina / eliminación
  /histor/i, // historical / histórica / historic note
  /reject/i, // "the enum ... rejects it"
  /no longer/i,
  /ya no/i, // Spanish "no longer"
  /never rewritten/i,
  /once (reserved|described)/i,
  /cerrados como/i, // Spanish "closed as [tdd]"
  /closed as/i,
  /ran as/i,
  // Two stems added in the 2026-09-17 loop-back round — MEASURED false
  // positives, not hypothetical (see the ticket hand-off for the exact
  // before/after run). Both cover legitimate retrospective sentences that
  // mention "tdd" alongside a co-occurring prescriptive-cue word
  // (TDD_PRESCRIPTIVE_CUES below has both /default/i and /tests-after/i)
  // purely because the sentence is ENUMERATING the current tier alongside
  // the retired one, not instructing anyone to default to it:
  /\bya se fue\b/i, // "El tier tdd ya se fue del enum; hoy todo es tests-after o uat-only."
  /cerr[oó]\s+\d+\s+tickets?/i, // "TASK-212 cerro 100 tickets con tier tdd; el default hoy es tests-after."
  /closed \d+ tickets?/i, // English equivalent of the stem above, same shape
];

// Prescriptive cues — presence near a bare "tdd" mention that indicates an
// actual instruction to use/default-to/assign the retired tier, rather than
// a historical mention of its retirement. English and Spanish.
const TDD_PRESCRIPTIVE_CUES = [
  /default/i,
  /por defecto/i,
  /absent/i,
  /ausente/i,
  /\bsi no\b/i, // Spanish "if not" (as in "si no esta el tier")
  /impli/i, // implies / implica
  /assum/i, // assume / assumed
  /se asume/i,
  // Hyphen-excluding boundary (2026-09-17 loop-back round, real false
  // positive surfaced by widening enumerateConsumerSurfaces to
  // skills/mcp-server/references/tool-contract.md, previously unscanned):
  // plain \b treats a hyphen as a word boundary too, so "RESUME-FIRST" (an
  // unrelated compound term naming the session-resume protocol) tripped the
  // bare /\bfirst\b/i cue purely by having "FIRST" as its second half. The
  // exclusion covers both letters/digits/underscore AND the hyphen on both
  // sides, so a real prescriptive "first" (space-delimited, e.g. "tdd comes
  // first") still matches.
  /(?<![\w-])first(?![\w-])/i,
  /primero/i,
  /precede/i,
  /preceder/i,
  /tests-after/i, // co-occurrence with sibling tier names suggests an enum re-listing tdd
  /uat-only/i,
];

/**
 * Scans `text` for bare `tdd` mentions that are NOT legitimate historical
 * prose (per the allowlist) and ARE accompanied by a prescriptive cue
 * (per the cue list) within a fixed character window. Returns an array of
 * `{ index, snippet }` — empty means no revival found.
 */
export function findTddRevivalMatches(text) {
  const matches = [];
  const re = /\btdd\b/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const start = Math.max(0, m.index - TDD_WINDOW_RADIUS);
    const end = Math.min(text.length, m.index + TDD_WINDOW_RADIUS);
    const window = text.slice(start, end);
    if (TDD_ALLOWLIST_STEMS.some((r) => r.test(window))) continue;
    if (TDD_PRESCRIPTIVE_CUES.some((r) => r.test(window))) {
      // Report a snippet CENTERED on the actual match (not the start of the
      // whole window) so a human reading a failure message sees the
      // violating text itself, not unrelated context that happens to
      // precede it in the window.
      const snippetStart = Math.max(0, m.index - 80);
      const snippetEnd = Math.min(text.length, m.index + 80);
      const snippet = text.slice(snippetStart, snippetEnd).replace(/\s+/g, ' ').trim();
      matches.push({ index: m.index, snippet });
    }
  }
  return matches;
}

/**
 * Returns the array of forbidden-pattern names / revival-match labels that
 * match `text`. Empty = clean. Deliberately does NOT strip fences/HTML
 * comments — see the MEDIUM-3 asymmetry note at the top of this file.
 */
export function findForbiddenMatches(text) {
  const literal = FORBIDDEN_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.name);
  const revival = findTddRevivalMatches(text).map(
    (match, i) => `tdd-tier-revival-generic#${i}: "${match.snippet}"`,
  );
  return [...literal, ...revival];
}

// ---------------------------------------------------------------------------
// Required presence checks — the two 2026-09-16 gates that must be reachable
// on the specific surfaces the wargaming campaign found missing them.
//
// All of these strip fenced code blocks and HTML comments first (MEDIUM-3):
// a rule that only exists inside a fence, or inside a "this is retired,
// don't do this" HTML comment, is not actually in force.
// ---------------------------------------------------------------------------

/**
 * developer.md must carry the Developer-side refusal rule: refuse to
 * implement without an approved use-case list, both as the general Inputs
 * statement and as the concrete Spanish "TDD ELIMINADO" refusal instruction.
 */
export function hasDeveloperRefusalGate(developerText) {
  const text = stripFencesAndComments(developerText);
  const hasGeneralStatement = /no approved list, no implementation/i.test(text);

  const headingIdx = text.search(/^## TDD ELIMINADO/m);
  const section = headingIdx === -1 ? '' : text.slice(headingIdx, headingIdx + 4000);
  // Window widened from 200 to 500 chars (LOW-2): the previous 200-char cap
  // false-red on harmless prose insertions between the two refusal phrases.
  const refuseRe =
    /no empieces a implementar[\s\S]{0,500}devolve el control al Orquestador|devolve el control al Orquestador[\s\S]{0,500}no empieces a implementar/i;
  const hasRefusalInstruction = headingIdx !== -1 && refuseRe.test(section);

  return { ok: hasGeneralStatement && hasRefusalInstruction, hasGeneralStatement, hasRefusalInstruction };
}

/**
 * skills/orchestrator-routing/SKILL.md must carry the human-approval hard
 * stop AT the point where the Orchestrator dispatches to the Developer
 * (inside the numbered Workflow step 2, before step 4 spawns the Developer),
 * not only as a general policy paragraph elsewhere in the file.
 */
export function hasSkillDispatchHardStop(skillText) {
  const text = stripFencesAndComments(skillText);
  const stopPhrase = "Then STOP and get the human's approval of the list";
  const stopIdx = text.indexOf(stopPhrase);
  // Loosened from the exact literal '1. **Fetch ticket.**' (LOW-2): a
  // harmless rewording to "Fetch the ticket." used to false-red this check.
  const step1Match = text.match(/1\.\s*\*\*Fetch(?: the)? ticket\.\*\*/);
  const step1Idx = step1Match ? step1Match.index : -1;
  const step4Idx = text.indexOf('4. **Verify per tier.**');

  const positioned = stopIdx !== -1 && step1Idx !== -1 && step4Idx !== -1 && step1Idx < stopIdx && stopIdx < step4Idx;

  return { ok: positioned, stopIdx, step1Idx, step4Idx };
}

/**
 * reviewer.md must name the wargaming pass as the verification of record,
 * with the two SPECIFIC HIGH-finding rules the wargaming gate depends on
 * (missing wargaming record; missing approved use-case list) — matched by
 * their own wording, not by a bare count of "is a HIGH finding" occurrences
 * (MEDIUM-2: a count was satisfiable by an unrelated OBSERVABILITY bullet).
 */
export function hasReviewerWargamingGate(reviewerText) {
  const text = stripFencesAndComments(reviewerText);
  const headingIdx = text.search(/^## Wargaming gate/m);
  if (headingIdx === -1) {
    return { ok: false, hasVerificationOfRecordLine: false, hasNoWargamingRecordRule: false, hasNoApprovedListRule: false };
  }
  const section = text.slice(headingIdx, headingIdx + 3000);
  const hasVerificationOfRecordLine = /is not the verification of record/i.test(section);
  const hasNoWargamingRecordRule = /no recorded wargaming outcome is a HIGH finding/i.test(section);
  const hasNoApprovedListRule = /no human-approved use-case list is a HIGH finding/i.test(section);
  const ok = hasVerificationOfRecordLine && hasNoWargamingRecordRule && hasNoApprovedListRule;
  return { ok, hasVerificationOfRecordLine, hasNoWargamingRecordRule, hasNoApprovedListRule };
}

/**
 * skills/orchestrator-routing/SKILL.md must carry the wargaming step as the
 * LAST step before ticket close — positioned after "Spawn the Reviewer" and
 * before "Update ticket" in the numbered Workflow list — and must say a HIGH
 * wargaming finding blocks the close.
 */
export function hasSkillWargamingFinalStep(skillText) {
  const text = stripFencesAndComments(skillText);
  const wargamingPhrase = '**Wargaming step — the real verification (2026-09-16 human decision).**';
  const wgIdx = text.indexOf(wargamingPhrase);
  const reviewerStepIdx = text.indexOf('5. **Spawn the Reviewer.**');
  const updateStepIdx = text.indexOf('6. **Update ticket.**');
  const positioned =
    wgIdx !== -1 && reviewerStepIdx !== -1 && updateStepIdx !== -1 && reviewerStepIdx < wgIdx && wgIdx < updateStepIdx;
  const blocksClose = /A HIGH-severity wargaming finding blocks the close/.test(text);
  return { ok: positioned && blocksClose, positioned, blocksClose };
}

/**
 * vitest.config.all.js must no longer instruct that the Developer runs the
 * full (e2e-including) suite before hand-off — that execution moved to the
 * wargaming step (2026-09-16 decision, WG-H-017).
 */
export function vitestAllConfigDefersE2eToWargaming(vitestAllText) {
  const text = stripFencesAndComments(vitestAllText);
  const stillInstructsPreHandoff = /runs this before hand-off/i.test(text);
  const mentionsWargamingDeferral = /wargaming step/i.test(text);
  return { ok: !stillInstructsPreHandoff && mentionsWargamingDeferral, stillInstructsPreHandoff, mentionsWargamingDeferral };
}

// commands/loop.md's real step list lives inside ONE fenced pseudocode block,
// immediately after the "### Step 2 — Loop until done, stopped, or stuck"
// heading. `extractLoopStepsBlock` (2026-09-17 loop-back round, MEDIUM edge)
// returns ONLY that block's contents — nothing before it, nothing after it,
// and nothing inside any OTHER fence in the file. This is what closes the
// adversary's "historical appendix" bypass: pasting a
// "APENDICE HISTORICO (derogado, NO rige)" section BEFORE the real step
// list, containing the four required phrases in the expected relative
// order, used to satisfy `hasLoopMdGates` via `text.indexOf` finding the
// decoy occurrences first — even while the REAL step 3/6 inside the fence
// had been gutted. An appendix placed anywhere outside this one specific
// fence is now structurally invisible to the check: `extractLoopStepsBlock`
// returns '' if the heading or its fence can't be found, and the four
// phrase lookups below run against that extracted span only.
function extractLoopStepsBlock(text) {
  const headingMatch = text.match(/^###\s*Step 2\s*[—-]\s*Loop until done/m);
  if (!headingMatch) return '';
  const afterHeading = text.slice(headingMatch.index + headingMatch[0].length);
  const fenceStart = afterHeading.indexOf('```');
  if (fenceStart === -1) return '';
  const afterFenceOpen = afterHeading.slice(fenceStart + 3);
  const fenceEnd = afterFenceOpen.indexOf('```');
  if (fenceEnd === -1) return '';
  return afterFenceOpen.slice(0, fenceEnd);
}

/**
 * commands/loop.md must carry BOTH 2026-09-16 gates as actual loop steps,
 * not only as general prose (HIGH-3): the mandatory use-case-approval STOP
 * positioned before the Developer is spawned (step 3, before step 4), and
 * the wargaming step positioned after the Developer/Reviewer spawn and
 * before the hard-stop-gate/close step, with the "blocks the close" rule
 * stated. Reverting this file to a gates-free version, or deleting either
 * step wholesale, must go RED here.
 *
 * 2026-09-17 loop-back round: checks now run ONLY inside the Step 2 fenced
 * step list (see `extractLoopStepsBlock` above) instead of over the whole
 * file — closes the "historical appendix placed before the real steps"
 * bypass described in the WG2-233-001 hand-off's MEDIUM edge 2.
 */
export function hasLoopMdGates(loopMdText) {
  const withoutComments = stripHtmlCommentsOnly(loopMdText);
  const text = extractLoopStepsBlock(withoutComments);

  const approvalPhrase = "STOP for the human's EXPLICIT";
  const devSpawnPhrase = 'Spawn the Developer subagent, briefed with the approved use-case list';
  const wargamingPhrase = 'Wargaming step: once the review is green, run the adversarial';
  // Wrapped across a line break in the real file ("wargaming\n     finding
  // blocks the close") — match with whitespace-tolerant regex, not a
  // single-line literal substring.
  const blocksCloseRe = /A HIGH-severity wargaming\s+finding blocks the close/;

  const approvalIdx = text.indexOf(approvalPhrase);
  const devSpawnIdx = text.indexOf(devSpawnPhrase);
  const wargamingIdx = text.indexOf(wargamingPhrase);
  const blocksCloseMatch = text.match(blocksCloseRe);
  const blocksCloseIdx = blocksCloseMatch ? blocksCloseMatch.index : -1;

  const hasApprovalGate = approvalIdx !== -1 && devSpawnIdx !== -1 && approvalIdx < devSpawnIdx;
  const hasWargamingGate =
    devSpawnIdx !== -1 &&
    wargamingIdx !== -1 &&
    blocksCloseIdx !== -1 &&
    devSpawnIdx < wargamingIdx &&
    wargamingIdx < blocksCloseIdx;

  return { ok: hasApprovalGate && hasWargamingGate, hasApprovalGate, hasWargamingGate };
}
