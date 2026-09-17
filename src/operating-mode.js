// src/operating-mode.js
// TASK-063 — Operating-mode state (loop vs harness).
//
// Exposes getMode / setMode for reading and writing the session's operating
// mode ('harness' | 'loop') via the active bundle.  Uses the existing pointer
// + bundle helpers so there is one atomic-write path for all session state.

import { readFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';

import { readPointer, pointerFilePath } from './pointer.js';
import {
  readBundleSessionOrThrow, writeBundleSession, bundleSessionPath,
  sessionsDir, bundleDirFor,
} from './bundle.js';

// ---------------------------------------------------------------------------
// Single source-of-truth enum.  All callers MUST reference this constant so
// a future value addition (e.g. 'dry-run') only needs to be added here.
// ---------------------------------------------------------------------------
export const OPERATING_MODES = ['harness', 'loop'];

// TASK-236 (WG-H-007/WG-H-010, wargaming 2026-09-16) — thrown by getMode when
// the pointer or the active bundle EXISTS but cannot be trusted: corrupt JSON
// (truncated file), a pointer naming a session whose bundle directory does
// not exist (a "ghost" pointer), or a pointer declaring a schema_version this
// code does not recognize. `.code` lets a caller distinguish which of the
// three happened instead of inferring from a generic Error. This is the
// empty-result contract (TASK-192, CLAUDE.md) applied to getMode: 'harness'
// now means ONLY "no session / no mode declared" (legitimate, silent); any
// state that EXISTS but is unreadable is a NAMED error, never a silent
// 'harness' default — see getMode's doc comment below for the full case
// table and why the prior "swallow everything" behavior let corrupting a
// state file turn a denied close into a permitted one.
export class ModeStateError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ModeStateError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// TASK-236 wargaming fix-round (WG-1, 2026-09-17) — getMode used to validate
// the `mode` VALUE only, never the SHAPE of the containers it reads. Four
// helpers close that gap; each is named after the root cause it fixes so a
// future reader can match it back to the finding:
//
//   - SESSION_ID_RE / isSessionIdFormatValid — root cause (b): a pointer's
//     active_session_id was joined into a filesystem path with no format
//     validation at all, so `..` re-read state/session.json itself as the
//     "bundle" and `../../../../../../tmp/x` escaped the repo entirely and
//     honored an attacker/accident-controlled file's `mode`. The regex is
//     derived directly from src/bundle.js's newSessionId — the ONLY producer
//     of this field — so anything not shaped like
//     `YYYYMMDDTHHMMSSZ-<8 lowercase hex>` (in particular anything containing
//     `/`, `\`, or `..`, or an absolute path) is rejected before it is ever
//     joined into a path.
//   - isPlainObject — root cause (a)/(d): `!pointer || pointer.x == null`
//     accepts any truthy non-object (an array, a number, a string), and
//     `bundle.mode` was read off whatever JSON.parse produced, including
//     scalars/arrays (property access on a primitive silently yields
//     `undefined` rather than throwing). Both the pointer and the bundle are
//     now required to be plain objects before their fields are trusted.
//   - readPointerForMode — root cause (c): readPointer's existsSync(p)
//     FOLLOWS symlinks and reports `false` for a dangling symlink, so a
//     broken symlink at state/session.json read back identically to "no
//     pointer file at all". lstatSync reports the dirent itself without
//     following it, so a broken symlink is correctly seen as "exists" and
//     then fails at the subsequent read as corrupt, not idle. This same
//     function also fixes a second ambiguity readPointer's shape does not
//     expose: JSON.parse('null') and "the file does not exist" both collapse
//     to the in-memory value `null`, which is exactly how a pointer file
//     containing the literal JSON `null`/`true`/`42`/`"str"`/`[]` used to
//     read back as ordinary idle state. Reading state/session.json here with
//     its own lstat-then-read-then-parse sequence (instead of reusing
//     readPointer) keeps "absent" and "exists but wrong shape" from ever
//     being conflated. It also strips a leading UTF-8 BOM before parsing
//     (WG-4) — a BOM-prefixed pointer file, something ordinary editors
//     produce, is otherwise indistinguishable from truncated JSON and would
//     needlessly hard-block every close in a repo that has never touched
//     loop mode.
//   - assertBundleContainerNotSymlinked below — a defense-in-depth close for
//     the same corrupt-container class: even with a format-valid session id,
//     none of state/, state/sessions/, or the session's own bundle directory
//     may itself be a symlink, so a symlink placed at any of those three
//     specific paths pointing outside the repo cannot make this function
//     read and honor an arbitrary external file's `mode`.
//
//     TASK-236 WG-3 (third wargaming pass, 2026-09-17, finding
//     WG3-236-001) — this bullet originally described a REALPATH-based
//     check: resolve the bundle file and sessionsDir() via realpathSync and
//     compare the two resolved paths. That check is CLOSED, not merely
//     patched, because its root cause was structural: it is blind to a
//     symlink AT or ABOVE state/sessions/ itself. If state/sessions (or
//     state/ entire) is a symlink to an external directory, realpathSync
//     resolves BOTH sides of the comparison through that same symlink and
//     they agree — relative() comes back "<id>/session.json" and the
//     (wrong) conclusion is "contained", while getMode goes on to read and
//     HONOR the external file's declared mode (WG-H-007's original class,
//     reopened by a different root cause than the one WG-1 closed: the
//     CONTAINER itself, not the value, was the escape hatch this time).
//     lstatSync never follows a symlink — it reports the dirent AT that
//     exact path — so checking state/, state/sessions/, and
//     state/sessions/<id>/ individually with lstat, and refusing outright
//     if ANY of them is itself a symlink rather than resolving through it
//     and comparing destinations, closes the vector realpath comparison
//     structurally could not: there is nothing left to fool when nothing is
//     resolved. Rejecting a symlinked container is also the only choice
//     consistent with this repo's real layout: worktree provisioning here
//     only ever symlinks node_modules (see
//     tests/e2e/git-worktree-handback.spec.js and
//     tests/e2e/worktree-node-modules-provisioning.spec.js), never state/ or
//     any of its descendants, so a symlink found at any of these three
//     specific paths is never a legitimate worktree artifact — it can
//     safely be denied outright, the same direction as every other
//     corrupt-state case getMode already throws for.
// ---------------------------------------------------------------------------
const SESSION_ID_RE = /^\d{8}T\d{6}Z-[0-9a-f]{8}$/;

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

function describeNonObject(value) {
  if (Array.isArray(value)) return 'an array';
  return JSON.stringify(value);
}

/**
 * Read state/session.json the way getMode needs to: distinguishes "does not
 * exist at all" (legitimate idle — returns null) from "exists but is
 * unreadable, unparsable, or not a JSON object" (corrupt — throws
 * ModeStateError). See the block comment above for why this cannot simply
 * delegate to src/pointer.js's readPointer.
 */
function readPointerForMode(repoRoot) {
  const p = pointerFilePath(repoRoot);

  try {
    lstatSync(p);
  } catch (err) {
    if (err && err.code === 'ENOENT') return null; // legitimately absent
    throw new ModeStateError(
      `getMode: state/session.json could not be inspected (${err.message})`,
      'E_MODE_POINTER_CORRUPT',
    );
  }

  let raw;
  try {
    raw = readFileSync(p, 'utf8');
  } catch (err) {
    // Covers a dangling symlink: lstat above sees the link itself and
    // reports "exists"; this follows it and fails against the missing
    // target, which is corrupt state, never silent idle.
    throw new ModeStateError(
      `getMode: state/session.json exists but could not be read (${err.message})`,
      'E_MODE_POINTER_CORRUPT',
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(stripBom(raw));
  } catch (err) {
    throw new ModeStateError(
      `getMode: state/session.json exists but could not be parsed (${err.message})`,
      'E_MODE_POINTER_CORRUPT',
    );
  }

  if (!isPlainObject(parsed)) {
    throw new ModeStateError(
      'getMode: state/session.json exists but does not contain a JSON object '
        + `(parsed to ${describeNonObject(parsed)})`,
      'E_MODE_POINTER_INVALID',
    );
  }

  return parsed;
}

/**
 * TASK-236 WG-3 (finding WG3-236-001, 2026-09-17) — reject outright, via
 * lstat (never realpath), if state/, state/sessions/, a session's own bundle
 * directory (state/sessions/<sessionId>/), or that directory's session.json
 * FILE (added WG-4, finding WG4-236-002) is itself a symlink. See the
 * module-level WG-1/WG-3 block comment above for why lstat replaces the
 * earlier realpath-based comparison and why rejecting a symlinked container
 * cannot break a legitimate worktree setup (this repo only ever symlinks
 * node_modules for worktree provisioning, never state/ or its descendants).
 * The session.json file is additionally rejected when its own `nlink > 1`
 * (a hardlink) — see the function body's own comment for why lstat's type
 * check alone cannot see a hardlink and why the extra check is low-risk.
 *
 * Exported (not just used internally) so src/close-guard.js's readLoopAuth
 * applies the exact same containment — including the file-level check —
 * before it reads loop_auth off the bundle directly: readLoopAuth does not
 * go through getMode, so without this one shared function it would need its
 * own, separately-maintained copy of the same checks (see readLoopAuth's own
 * doc comment for the harm an out-of-sync copy caused before WG-4).
 *
 * A missing path component (ENOENT) is not this function's concern — it
 * returns silently and lets the caller's own missing-pointer/missing-bundle
 * handling report that; only an EXISTING container or file that is a
 * symlink (or, for the file, hardlinked) or cannot even be inspected is
 * rejected here.
 */
export function assertBundleContainerNotSymlinked(repoRoot, sessionId) {
  const dirCandidates = [
    join(repoRoot, 'state'),
    sessionsDir(repoRoot),
    bundleDirFor(repoRoot, sessionId),
  ];
  for (const dir of dirCandidates) {
    let st;
    try {
      st = lstatSync(dir);
    } catch (err) {
      if (err && err.code === 'ENOENT') return; // nothing here yet — caller's own missing-bundle path handles it
      throw new ModeStateError(
        `getMode: ${dir} could not be inspected (${err.message})`,
        'E_MODE_BUNDLE_CORRUPT',
      );
    }
    if (st.isSymbolicLink()) {
      throw new ModeStateError(
        `getMode: ${dir} is a symlink — state/, state/sessions/, and a session's own bundle `
          + "directory must be real directories, never a symlink (a symlinked container can make "
          + "an external file's declared mode resolve as if it were this repo's own state, "
          + 'bypassing containment entirely — WG3-236-001)',
        'E_MODE_BUNDLE_CORRUPT',
      );
    }
  }

  // TASK-236 WG-4 (fourth wargaming pass, 2026-09-17, finding WG4-236-002) —
  // the session's own session.json FILE gets the identical lstat check, in
  // this same shared function, so every caller of
  // assertBundleContainerNotSymlinked is contained the same way for the file,
  // not only for the three directories above it. Before this round the
  // file-level symlink check lived only inside getMode's own body (a second
  // lstat that function never shared with anyone), so readLoopAuth below —
  // which calls this function but then reads the bundle itself via
  // readBundleSession, never going through getMode — had no containment at
  // all for a session.json that was itself a symlink to an external file,
  // even when the three directories around it were all real. The adversary's
  // measured race (87919 iterations, 7963 honoring the external file's
  // loop_auth verbatim) is exactly this gap; moving the check here, rather
  // than adding a second copy inside readLoopAuth, is what makes "the same
  // check" literally true instead of two independently-maintained copies
  // that can drift.
  //
  // A plain hardlink to an external file is invisible to this lstat's
  // `isSymbolicLink()` test (a hardlinked regular file is, by construction,
  // an ordinary regular file — `lstat` cannot tell it apart from a genuine
  // one by type). The adversary's own proposed candado is what closes that
  // neighboring gap: `st.nlink > 1` for a regular file that is supposed to
  // be this session's sole, privately-written session.json. Every
  // session.json this repo's own writers ever produce (writeBundleSession,
  // via atomicWriteFile's write-then-rename) is written fresh and is never
  // hardlinked anywhere else, so a real bundle's file always reports
  // `nlink === 1`; creating a second link to it requires the same in-repo
  // write access that would let an attacker edit the file directly, so this
  // is a cheap, low-risk candado, not a load-bearing security boundary on
  // its own — see the ticket hand-off for the availability checks run
  // against it (worktree provisioning, symlinked repoRoot, a directory above
  // repoRoot symlinked, and a read-only repo all still start correctly).
  const filePath = bundleSessionPath(repoRoot, sessionId);
  let fileSt;
  try {
    fileSt = lstatSync(filePath);
  } catch (err) {
    if (err && err.code === 'ENOENT') return; // no bundle file yet — caller's own missing-bundle path handles it
    throw new ModeStateError(
      `getMode: ${filePath} could not be inspected (${err.message})`,
      'E_MODE_BUNDLE_CORRUPT',
    );
  }
  if (fileSt.isSymbolicLink()) {
    throw new ModeStateError(
      `getMode: ${filePath} is a symlink — a session's own session.json must be a real file, `
        + "never a symlink (the same containment WG3-236-001 applies to its parent directories "
        + 'now also applies to the file itself — WG4-236-002)',
      'E_MODE_BUNDLE_CORRUPT',
    );
  }
  if (fileSt.nlink > 1) {
    throw new ModeStateError(
      `getMode: ${filePath} has ${fileSt.nlink} hard links — a session's own session.json must `
        + 'be an ordinary, singly-linked file (a hardlink to an external file cannot be told apart '
        + "from this repo's own bundle content by lstat's type alone, so it is rejected outright "
        + 'rather than trusted)',
      'E_MODE_BUNDLE_CORRUPT',
    );
  }
}

// ---------------------------------------------------------------------------
// getMode({ repoRoot }) → 'harness' | 'loop'
//
// Reads the pointer, then reads the active bundle, and returns bundle.mode
// if present and valid.
//
// TASK-236 (WG-H-007/WG-H-010) — getMode used to catch EVERY error (missing
// pointer, missing bundle, corrupt JSON, unrecognized schema_version) in one
// blanket try/catch and return 'harness' regardless of which happened. That
// made a truncated/corrupted state file indistinguishable from a legitimate
// idle repo — and because src/close-guard.js's loopModeCloseGuard only acts
// when mode === 'loop', corrupting a state file silently turned a DENIED
// close into a PERMITTED one (a safety guard failing open, the wrong
// direction for a safety guard).
//
// getMode now distinguishes exactly two families of outcome:
//   - LEGITIMATE 'harness' (returned normally, no error): no pointer file at
//     all, pointer.active_session_id is null (or the field is absent
//     entirely — a legacy v1 pointer shape), or the bundle exists and simply
//     does not declare a `mode` field. This is the documented idle state and
//     MUST keep working unmodified (a fresh repo with no state/ is the
//     common case, not a defect).
//   - CORRUPT STATE (thrown ModeStateError, never masked as 'harness'): the
//     pointer file exists but is not valid JSON, or is valid JSON that is
//     not a plain object — e.g. `[]`, `null`, `true`, `42`, `"str"`
//     (E_MODE_POINTER_CORRUPT / E_MODE_POINTER_INVALID — see
//     readPointerForMode above); the pointer declares a schema_version other
//     than the one this code understands, or an active_session_id whose
//     format does not match what src/bundle.js's newSessionId produces —
//     which is also what rejects a path-traversal attempt like `..` or
//     `../../../../../../tmp/x` before it is ever joined into a path
//     (E_MODE_POINTER_INVALID); the pointer names a session whose bundle
//     session.json does not exist, i.e. a ghost pointer (E_MODE_BUNDLE_MISSING);
//     state/, state/sessions/, the session's own bundle directory, or
//     session.json itself is a symlink — checked by lstat, never resolved,
//     so a symlink AT or ABOVE state/sessions/ (not only at the per-session
//     directory or the file) cannot be used to make this function read and
//     honor an arbitrary external file's mode (E_MODE_BUNDLE_CORRUPT — see
//     assertBundleContainerNotSymlinked above; TASK-236 WG-3, finding
//     WG3-236-001, closed after the container-symlink class survived the
//     WG-1 realpath-based check by escaping ABOVE the comparison instead of
//     inside it); the bundle's own session.json exists but is not valid
//     JSON, or is valid JSON that is not a plain object — e.g. `true`, `42`,
//     `[]`, `"str"` (E_MODE_BUNDLE_CORRUPT); or the bundle IS a plain object
//     and DOES declare a `mode` field, but the value is not one of
//     OPERATING_MODES (e.g. 'loop' byte-corrupted in place to 'lo0p')
//     (E_MODE_BUNDLE_INVALID). This last case is deliberately distinct from
//     "no mode field at all" (legitimate harness, above): a bundle that
//     never mentions `mode` is the documented idle/legacy shape, but a
//     bundle that mentions `mode` with a value this code does not recognize
//     is state that exists and cannot be trusted — the same
//     distinguishability contract the other corrupt-state cases already
//     apply.
//
// TASK-236 WG-3 (2026-09-17) — until this fix-round, "exactly two families
// of outcome" above was FALSIFIED by the container-symlink vector: reading
// through a symlinked state/sessions/ (or a symlinked state/ entire)
// produced a THIRD, silent family — an externally-sourced 'harness' or
// 'loop' value, read and returned as if it were this repo's own state,
// neither the legitimate-idle case nor a thrown ModeStateError. With
// assertBundleContainerNotSymlinked in place, that third family is closed:
// every read this function performs is now confirmed, by lstat, to
// terminate inside state/sessions/ of THIS repo before any of its content is
// trusted, so the two-family claim is accurate again, not merely restated.
//
// Callers that do not catch ModeStateError (e.g. src/close-guard.js's
// loopModeCloseGuard/loopModeUatCommentGuard) let it propagate, which aborts
// whatever guarded operation was in flight — denying/escalating rather than
// silently permitting, which is the property WG-H-007 requires: a corrupted
// bundle must never make a guard MORE permissive than the same guard is with
// a healthy bundle.
// ---------------------------------------------------------------------------
export async function getMode({ repoRoot }) {
  const pointer = readPointerForMode(repoRoot);

  // TASK-236 LOW-3 (review 2026-09-17), updated by the WG-1 fix-round
  // (2026-09-17) — ONE deliberate silent-'harness' edge lives in this
  // short-circuit and the ordering below; write down why so a future pass
  // does not "fix" it by accident. (A second edge used to live here too — a
  // pointer that PARSED to a non-object bypassed all validation via this
  // same `== null` short-circuit, because a non-null non-object is truthy
  // and lacks `.active_session_id`. That bypass is now closed one level up:
  // readPointerForMode never returns a non-object — it is either `null`
  // (legitimately absent) or a validated plain object — so this line only
  // ever sees one of those two shapes.)
  //   - a pointer that parses fine but simply lacks `active_session_id` (a
  //     legacy v1 pointer shape, which predates schema_version and
  //     active_session_id both), or explicitly declares it `null`, returns
  //     'harness' with no error via this `== null` short-circuit.
  //   - the schema_version check right below is ordered AFTER this
  //     short-circuit, so `{schema_version: 999, active_session_id: null}`
  //     ALSO returns 'harness' silently instead of hitting
  //     E_MODE_POINTER_INVALID — schema_version is never even inspected
  //     when there's no active session to report on.
  // Both are correct as written, not oversights: they are what lets a
  // legacy v1 state file (no active_session_id at all) keep reading as
  // ordinary idle harness instead of a hard error, per AC5 and this
  // ticket's own out-of-scope note (v1→v2 migration is not this ticket's
  // job). The schema_version/session-id-format/ghost-bundle/corrupt-bundle
  // checks below only ever fire once there IS a real active_session_id to
  // validate against.
  if (!pointer || pointer.active_session_id == null) return 'harness';

  if (pointer.schema_version !== 2) {
    throw new ModeStateError(
      'getMode: state/session.json has an unrecognized schema_version '
        + `(${JSON.stringify(pointer.schema_version)}, expected 2)`,
      'E_MODE_POINTER_INVALID',
    );
  }

  // TASK-236 WG-1(b) — reject anything not shaped like a real newSessionId
  // output BEFORE it is joined into a filesystem path. This is what closes
  // the path-traversal vector: `..` used to make bundleSessionPath resolve
  // to state/session.json ITSELF (re-read as the "bundle"), and
  // `../../../../../../tmp/x` escaped the repo entirely and honored
  // whatever `mode` an arbitrary external file declared.
  if (typeof pointer.active_session_id !== 'string' || !SESSION_ID_RE.test(pointer.active_session_id)) {
    throw new ModeStateError(
      'getMode: state/session.json declares an active_session_id with an unrecognized format '
        + `(${JSON.stringify(pointer.active_session_id)})`,
      'E_MODE_POINTER_INVALID',
    );
  }

  // TASK-236 WG-3 (finding WG3-236-001) — even with a format-valid session
  // id, none of state/, state/sessions/, or the session's own bundle
  // directory may itself be a symlink. This SUPERSEDES the WG-1
  // defense-in-depth's realpath-based comparison (see
  // assertBundleContainerNotSymlinked's own doc comment, and the module-level
  // WG-1/WG-3 block comment near the top of this file, for why a realpath
  // comparison of the bundle file against sessionsDir() cannot see a symlink
  // AT or ABOVE state/sessions/ itself: resolving both sides through the same
  // symlink makes them agree).
  assertBundleContainerNotSymlinked(repoRoot, pointer.active_session_id);

  const bundleFilePath = bundleSessionPath(repoRoot, pointer.active_session_id);
  let bundleFileStat;
  try {
    bundleFileStat = lstatSync(bundleFilePath);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      throw new ModeStateError(
        `getMode: the pointer names session ${pointer.active_session_id} but no bundle was `
          + `found at ${bundleFilePath}`,
        'E_MODE_BUNDLE_MISSING',
      );
    }
    throw new ModeStateError(
      `getMode: the bundle for session ${pointer.active_session_id} could not be inspected `
        + `(${err.message})`,
      'E_MODE_BUNDLE_CORRUPT',
    );
  }
  if (bundleFileStat.isSymbolicLink()) {
    throw new ModeStateError(
      `getMode: the bundle for session ${pointer.active_session_id} at ${bundleFilePath} is a `
        + 'symlink and cannot be trusted (see assertBundleContainerNotSymlinked above for why a '
        + 'symlinked container or file is rejected outright rather than resolved)',
      'E_MODE_BUNDLE_CORRUPT',
    );
  }

  let bundleRaw;
  try {
    bundleRaw = readFileSync(bundleFilePath, 'utf8');
  } catch (err) {
    throw new ModeStateError(
      `getMode: the bundle for session ${pointer.active_session_id} exists but could not be `
        + `read (${err.message})`,
      'E_MODE_BUNDLE_CORRUPT',
    );
  }

  let bundle;
  try {
    // TASK-236 WG-3 MEDIO-1 — strip a leading BOM here too, the same as
    // readPointerForMode already does for the pointer. This reads the bundle
    // file directly (rather than delegating to bundle.js's readBundleSession,
    // which does not strip a BOM and is outside this ticket's src/ surface)
    // — readBundleSession's other job, migrateRetiredTestPhase, only touches
    // workflow_step/loop_state.phase, neither of which getMode inspects, so
    // reading here without it changes nothing getMode reads. Without this, a
    // BOM-prefixed bundle.session.json — something ordinary editors produce,
    // same as a BOM-prefixed pointer — is otherwise indistinguishable from
    // truncated JSON and would needlessly hard-block every close whose
    // bundle happens to carry one.
    bundle = JSON.parse(stripBom(bundleRaw));
  } catch (err) {
    throw new ModeStateError(
      `getMode: the bundle for session ${pointer.active_session_id} exists but could not be `
        + `parsed (${err.message})`,
      'E_MODE_BUNDLE_CORRUPT',
    );
  }

  // TASK-236 WG-1(a)/(d) — the bundle must be a plain object before ANY of
  // its fields are trusted. Before this check, a bundle whose session.json
  // parsed to a scalar or an array (e.g. `42`, `true`, `[]`) silently read
  // `bundle.mode` as `undefined` (property access on a primitive/array does
  // not throw) and fell through to the legitimate-harness return below —
  // and a bundle that parsed to JSON `null` threw an unnamed TypeError
  // instead (WG-2). Both are now the same named, distinguishable error.
  if (!isPlainObject(bundle)) {
    throw new ModeStateError(
      `getMode: the bundle for session ${pointer.active_session_id} exists but is not a JSON `
        + `object (parsed to ${describeNonObject(bundle)})`,
      'E_MODE_BUNDLE_CORRUPT',
    );
  }

  // TASK-236 MEDIUM-1 (review 2026-09-17) — `bundle.mode == null` (no `mode`
  // field at all) is the legitimate, silent 'harness' default (CU5). A
  // bundle that DOES declare `mode` but with a value outside
  // OPERATING_MODES is corrupt state, not idle state, and must be a named
  // error like the other corrupt-state cases above — the prior "anything
  // not recognized silently becomes harness" collapsed "no mode declared"
  // and "mode declared but garbage" into one indistinguishable outcome,
  // which is exactly the TASK-192 distinguishability contract this whole
  // ticket exists to restore.
  if (bundle.mode != null && !OPERATING_MODES.includes(bundle.mode)) {
    throw new ModeStateError(
      `getMode: the bundle for session ${pointer.active_session_id} declares an unrecognized `
        + `mode (${JSON.stringify(bundle.mode)}, expected one of: ${OPERATING_MODES.join(', ')})`,
      'E_MODE_BUNDLE_INVALID',
    );
  }

  return bundle.mode == null ? 'harness' : bundle.mode;
}

// ---------------------------------------------------------------------------
// setMode({ repoRoot, mode }) → void
//
// Validates `mode` against OPERATING_MODES (throws on anything invalid,
// including non-strings, null, '', numbers, unknown strings).  Resolves the
// active bundle via the pointer, merges `mode` into the bundle session object,
// and writes it back atomically via writeBundleSession.  Idempotent.
// ---------------------------------------------------------------------------
export async function setMode({ repoRoot, mode }) {
  if (!OPERATING_MODES.includes(mode)) {
    throw new Error(
      `Invalid mode ${JSON.stringify(mode)}. Must be one of: harness, loop.`,
    );
  }

  const pointer = readPointer(repoRoot);
  if (!pointer || pointer.active_session_id == null) {
    throw new Error('No active session — cannot set mode without an active bundle.');
  }

  const sessionId = pointer.active_session_id;
  // TASK-092 — tailor the missing-bundle-dir case into a typed
  // E_BUNDLE_MISSING rather than a raw ENOENT (shared with src/loop-auth.js
  // and src/loop-checkpoint.js's writeLoopCheckpoint). getMode above is a
  // SEPARATE read path with its own typed errors as of TASK-236 (it now
  // throws ModeStateError — E_MODE_BUNDLE_MISSING/E_MODE_BUNDLE_CORRUPT/etc.
  // — on any pointer/bundle state that exists but is corrupt, rather than
  // defaulting to 'harness'; see getMode's own doc comment above for the
  // full case table). This function does not reuse that path — setMode
  // needs the raw bundle object to merge `mode` into and write back, which
  // readBundleSessionOrThrow already provides via its own typed
  // E_BUNDLE_MISSING, so no migration to getMode's helpers is needed here.
  const bundle = readBundleSessionOrThrow(repoRoot, sessionId, 'setMode');

  // Merge mode and refresh updated_at, then write atomically.
  const updated = {
    ...bundle,
    mode,
    updated_at: new Date().toISOString(),
  };

  await writeBundleSession(repoRoot, sessionId, updated);
}

// ---------------------------------------------------------------------------
// toggleMode({ repoRoot }) → 'harness' | 'loop'
//
// Reads the current mode via getMode, flips harness↔loop, calls setMode with
// the inverted value, then returns the NEW mode.  Requires an active session
// (setMode will throw if none).
// ---------------------------------------------------------------------------
export async function toggleMode({ repoRoot }) {
  const current = await getMode({ repoRoot });
  const next = current === 'loop' ? 'harness' : 'loop';
  await setMode({ repoRoot, mode: next });
  return next;
}
