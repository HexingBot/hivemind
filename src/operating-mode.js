// src/operating-mode.js
// TASK-063 — Operating-mode state (loop vs harness).
//
// Exposes getMode / setMode for reading and writing the session's operating
// mode ('harness' | 'loop') via the active bundle.  Uses the existing pointer
// + bundle helpers so there is one atomic-write path for all session state.

import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { relative, isAbsolute, sep } from 'node:path';

import { readPointer, pointerFilePath } from './pointer.js';
import {
  readBundleSession, readBundleSessionOrThrow, writeBundleSession, bundleSessionPath,
  sessionsDir,
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
//   - the realpath containment check inside getMode below — an additional
//     defense-in-depth close for the same corrupt-container class: even with
//     a format-valid session id, the bundle's session.json path is resolved
//     via realpathSync and confirmed to actually live inside
//     state/sessions/ of THIS repo before it is read, so a symlink placed at
//     state/sessions/<id> (or at session.json itself) pointing outside the
//     repo cannot make this function read and honor an arbitrary external
//     file's `mode`.
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
//     session.json does not exist, i.e. a ghost pointer, OR whose resolved
//     real path is not actually inside state/sessions/ of this repo — e.g. a
//     symlink escaping the repo (E_MODE_BUNDLE_MISSING); the bundle's own
//     session.json exists but is not valid JSON, or is valid JSON that is
//     not a plain object — e.g. `true`, `42`, `[]`, `"str"`
//     (E_MODE_BUNDLE_CORRUPT); or the bundle IS a plain object and DOES
//     declare a `mode` field, but the value is not one of OPERATING_MODES
//     (e.g. 'loop' byte-corrupted in place to 'lo0p') (E_MODE_BUNDLE_INVALID).
//     This last case is deliberately distinct from "no mode field at all"
//     (legitimate harness, above): a bundle that never mentions `mode` is
//     the documented idle/legacy shape, but a bundle that mentions `mode`
//     with a value this code does not recognize is state that exists and
//     cannot be trusted — the same distinguishability contract the other
//     corrupt-state cases already apply.
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

  // TASK-236 WG-1 defense-in-depth — even with a format-valid session id,
  // confirm the bundle's session.json REAL (symlink-resolved) path is
  // actually inside state/sessions/ of this repo before trusting it. Without
  // this, a symlink placed at state/sessions/<id> (or at session.json
  // itself) pointing outside the repo would let this function read and
  // honor an arbitrary external file's `mode`.
  const bundleFilePath = bundleSessionPath(repoRoot, pointer.active_session_id);
  let realBundleFile;
  try {
    realBundleFile = realpathSync(bundleFilePath);
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
  const realSessionsDir = realpathSync(sessionsDir(repoRoot));
  const relToSessionsDir = relative(realSessionsDir, realBundleFile);
  if (relToSessionsDir === '' || relToSessionsDir === '..'
      || relToSessionsDir.startsWith(`..${sep}`) || isAbsolute(relToSessionsDir)) {
    throw new ModeStateError(
      `getMode: the bundle for session ${pointer.active_session_id} resolves outside `
        + 'state/sessions/ of this repo (a symlink escaping the repo) and cannot be trusted',
      'E_MODE_BUNDLE_CORRUPT',
    );
  }

  let bundle;
  try {
    bundle = readBundleSession(repoRoot, pointer.active_session_id);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      throw new ModeStateError(
        `getMode: the pointer names session ${pointer.active_session_id} but no bundle was `
          + `found at ${bundleFilePath}`,
        'E_MODE_BUNDLE_MISSING',
      );
    }
    throw new ModeStateError(
      `getMode: the bundle for session ${pointer.active_session_id} exists but could not be `
        + `read (${err.message})`,
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
