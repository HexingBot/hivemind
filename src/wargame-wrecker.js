// src/wargame-wrecker.js
// TASK-240 (CU4) — the deterministic half of "wargame with Wrecker": turn the
// findings Wrecker's `wargame_findings` returns into (a) `[FINDING-HIGH: <id>]`
// marker comments, (b) non-blocking questions, and (c) the `[WARGAMING]` record
// body — so that mapping is code, not something the orchestrator improvises.
//
// Finding shape (read from Wrecker's real output, report.md / wargameFindings):
//   { finding_id, type, step_cited, count, plausibility, verified,
//     explanation, play }          — `type` is the kind (only `type` is read).
// Mapping (CU4):
//   counterexample | contradiction | dead_end -> FINDING-HIGH marker (blocks the
//        close until triaged: FINDING-RESOLVED, or FINDING-DEGRADED + reason).
//   gap -> question for the spec owner. NEVER a FINDING-HIGH marker and never a
//        regression test (Wrecker's rule).
//   any other kind -> throws: an unknown kind must not be silently dropped
//        (empty-result contract — absence of a mapping is not "nothing found").
//
// CU7 — a session cut by Wrecker's 120 s / RSS limit is NOT a finished run. Wrecker reports a cut
// as status.guard.hits[] (limit != max_play_steps, which only cuts individual plays) and, when it
// left a checkpoint, status.continue_with = the resume call. Each case must carry the FINAL
// session `status` (the one returned by the last dry_run/run_session call, after resuming) and a
// case whose status shows a cut or a pending continue_with is refused, so partial coverage or
// "0 findings so far" can never become a record. Same transcription limit as `lint` below.
// Input per attacked case: { case, path, spec?, session_id?, findings,
//   lint: the FINAL wargame_lint_spec result ({findings:[], ...}) — REQUIRED and must be clean:
//     Wrecker's MCP sessions run with accept_lint, so it does not refuse a spec that fails lint
//     (CU6); the lint has no warning tier, so ANY finding or parse problem blocks. HONEST LIMIT:
//     this object is transcribed by the orchestrator, so the check is transcription discipline,
//     not proof — paste the real wargame_lint_spec output (it always carries usecase and
//     spec_version, which are required here),
//   coverage?: { steps_reached: { reached, total, pct } },
//   steps_never_reached?: string[], dry_run_only?: boolean }
// plus top-level not_attacked: [{ case, reason }] for approved cases that got no spec.

const HIGH_KINDS = new Set(['counterexample', 'contradiction', 'dead_end']);
const ID_MAX = 40; // mirrors task-store.js FINDING_ID_MAX_LEN

function kindOf(f) {
  return String(f.type ?? '').trim();
}

// Free text going into a ticket comment: one line, and none of the characters
// the close guard treats as marker syntax or as "this is only a mention"
// (brackets, backticks, quotes), so it can neither forge nor neutralize a marker.
function oneLine(s) {
  return String(s ?? '').replace(/[\[\]`"'“”]/g, '').replace(/\s+/g, ' ').trim();
}

// Identifier-like values (case, step, path, spec, session): strict token.
function tok(s, fallback = '?') {
  const t = String(s ?? '').replace(/[^A-Za-z0-9._/-]/g, '-').replace(/^-+|-+$/g, '');
  return t || fallback;
}

function fallbackId(caseId, seq) {
  return `WR-${tok(caseId, 'X').replace(/[^A-Za-z0-9]/g, '')}-${String(seq).padStart(3, '0')}`.slice(0, ID_MAX);
}

// Stable ids (Wrecker's `stable_id` in the tools, `id` in /wrecker:wargame output) survive a re-run of
// the same spec, so a FINDING-HIGH keeps matching its RESOLVED/DEGRADED; `finding_id` is the
// per-session id and only a fallback.
function stableOf(f) {
  const v = f.stable_id ?? f.id;
  return typeof v === 'string' && /[A-Za-z0-9]/.test(v) ? v : null;
}

function markerId(f, caseId, seq) {
  const clean = String(stableOf(f) ?? f.finding_id ?? '').replace(/[^A-Za-z0-9._/-]/g, '-');
  if (/[A-Za-z0-9]/.test(clean) && clean.length <= ID_MAX) return clean;
  return fallbackId(caseId, seq);
}

// Cases built by fromSkill (and only those) are lint-guaranteed: the marker is module-private, so a
// hand-written direct-tools case cannot claim it (a caller-supplied `skill` flag is refused).
function idsOfFinding(f) {
  const a = [f.folded_ids, f.stable_ids].find((x) => Array.isArray(x) && x.length > 0);
  return (a ?? [stableOf(f)]).filter(Boolean).map(String);
}

const FROM_SKILL = new WeakMap(); // case object -> 'skill' | 'resumed'

// /wrecker:wargame (Wrecker >= 0.2.0) output -> the same inputs as the direct-tools shape.
// The skill refuses to attack a spec that does not lint to 0, so "no error key" means lint-clean;
// LINT_FAILED / TOOL_FAILED specs were NOT attacked and become not_attacked. The skill output has
// no guard/continue_with, but a session cut leaves a "... cut it ..." line in not_running: such a
// spec is NOT recorded as attacked. Use cases must be named CU<n> (the close guard's case syntax):
// pass them so to the skill, or add a top-level case_map {"UC-1":"CU1"}; nothing is guessed.
// CU7 resume: a cut spec is resumed by the orchestrator with the direct tool in the "continue it with"
// call of its not_running line (only resume_session_id, <=5 times). The final result is passed as
// out.resumed[<uc>] = a direct-tools case {status (finished), findings (stable_id), coverage,
// steps_never_reached?, session_id, path?}; it REPLACES the cut spec, is validated with the same
// refusals as a direct-tools case (finished status, findings present), and lint stays guaranteed
// because the spec already passed the skill's lint before the cut. A cut spec without a replacement
// is not_attacked (cap reached / resume failed: the human is told).
function fromSkill(out) {
  if (out.error === 'WRECKER_NOT_CONNECTED') {
    throw new Error('Wrecker is chosen but not connected (WRECKER_NOT_CONNECTED): nothing was attacked - follow the CU5 procedure (fix the connection and retry, or use the default engine THIS ONCE)');
  }
  if (out.error) throw new Error(`/wrecker:wargame returned error ${tok(out.error)}: nothing was attacked`);
  if (!Array.isArray(out.specs)) throw new Error('buildWreckerRecord: /wrecker:wargame output has no "specs" array');
  const map = out.case_map && typeof out.case_map === 'object' ? out.case_map : {};
  const cases = [];
  const notAttacked = [];
  const resumed = out.resumed && typeof out.resumed === 'object' ? out.resumed : {};
  const usedResumed = new Set();
  for (const sp of out.specs) {
    const label = String(map[sp.uc] ?? sp.uc ?? '');
    if (!/^CU\d+$/.test(label)) {
      throw new Error(`buildWreckerRecord: use case "${tok(sp.uc)}" is not named CU<n> - name the approved cases CU<n> when calling /wrecker:wargame or add case_map (e.g. {"UC-1":"CU1"})`);
    }
    if (sp.error) {
      const why = sp.error === 'LINT_FAILED'
        ? `LINT_FAILED: ${oneLine((sp.problems ?? []).map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('; '))}`
        : `${tok(typeof sp.error === 'string' ? sp.error : JSON.stringify(sp.error))}: ${oneLine(sp.message)}`;
      notAttacked.push({ case: label, reason: `spec not attacked, ${why}` });
      continue;
    }
    const nr = Array.isArray(sp.not_running) ? sp.not_running.map(String) : [];
    const isCut = nr.some((l) => /\bcut it\b/.test(l));
    const rkey = [sp.uc, label].find((k) => k !== undefined && Object.prototype.hasOwnProperty.call(resumed, k));
    if (rkey !== undefined && !isCut) {
      throw new Error(`buildWreckerRecord: "resumed" has an entry for ${tok(label)} but its spec was not cut - a finished run is never replaced`);
    }
    if (isCut && rkey === undefined) {
      const canResume = nr.some((l) => /continue it with/.test(l));
      notAttacked.push({ case: label, reason: `session cut by a Wrecker limit and not resumed to the end (${canResume ? 'resume cap reached or the resume failed' : 'no checkpoint to resume from'}): not a finished run` });
      continue;
    }
    if (typeof sp.spec_version !== 'string' || !sp.spec_version.trim() || typeof sp.spec_sha256 !== 'string' || !sp.spec_sha256.trim()) {
      throw new Error(`buildWreckerRecord: ${tok(label)} has no spec_version/spec_sha256 - the record must tie the run to the attacked spec`);
    }
    if (isCut) {
      usedResumed.add(rkey);
      const r = resumed[rkey];
      if (!r || typeof r !== 'object') throw new Error(`buildWreckerRecord: resumed entry for ${tok(label)} is not an object`);
      if (!r.status || typeof r.status.stop_reason !== 'string' || !r.status.stop_reason.trim()) {
        throw new Error(`buildWreckerRecord: resumed entry for ${tok(label)} has no status.stop_reason - a resumed run must show how it finished`);
      }
      // Wrecker restores the ledger on resume, so an honest final result still contains every blocking
      // candidate found before the cut; one that vanished must not be dropped silently.
      const rIds = new Set((Array.isArray(r.findings) ? r.findings : []).flatMap((f) => [...idsOfFinding(f)]).map((i) => i.toUpperCase()));
      const lost = (Array.isArray(sp.findings) ? sp.findings : []).filter((f) => HIGH_KINDS.has(kindOf(f)))
        .flatMap((f) => idsOfFinding(f)).filter((i) => !rIds.has(i.toUpperCase()));
      if (lost.length > 0) {
        throw new Error(`buildWreckerRecord: blocking ids found before the cut are missing from the resumed result (${lost.map((i) => tok(i)).join(', ')}) - an honest final wargame_findings still contains them`);
      }
      for (const l of nr) if (!/\bcut it\b/.test(l)) notAttacked.push({ case: label, reason: `not run: ${l}` });
      const rc = { ...r, case: label, uc: sp.uc, spec: sp.spec_path, spec_version: sp.spec_version, spec_sha256: sp.spec_sha256 };
      delete rc.skill; delete rc.lint;
      FROM_SKILL.set(rc, 'resumed');
      cases.push(rc);
      continue;
    }
    if (!Array.isArray(sp.paths_attacked)) throw new Error(`buildWreckerRecord: ${tok(label)} has no paths_attacked array`);
    for (const l of nr) notAttacked.push({ case: label, reason: `not run: ${l}` });
    const hit = sp.paths_attacked.filter((x) => x && x.attacked);
    for (const x of sp.paths_attacked) if (x && !x.attacked) notAttacked.push({ case: label, reason: `path ${tok(x.flow)} not attacked` });
    if (hit.length === 0) {
      notAttacked.push({ case: label, reason: 'no path was attacked' });
      continue;
    }
    const sc = {
      case: label, uc: sp.uc,
      path: hit.map((x) => `${tok(x.flow)}${x.reached ? '' : '(partial)'}`).join('/'),
      spec: sp.spec_path, spec_version: sp.spec_version, spec_sha256: sp.spec_sha256, session_id: sp.session_id,
      coverage: sp.coverage, findings: sp.findings,
    };
    FROM_SKILL.set(sc, 'skill');
    cases.push(sc);
  }
  for (const k of Object.keys(resumed)) {
    if (!usedResumed.has(k)) throw new Error(`buildWreckerRecord: "resumed" entry ${tok(k)} matches no cut spec - it would be lost silently`);
  }
  if (cases.length === 0) {
    throw new Error(`buildWreckerRecord: nothing was attacked (${notAttacked.map((n) => `${tok(n.case)}: ${n.reason}`).join(' | ') || 'no specs'}) - record these cases as NOT attacked, not as a Wrecker pass`);
  }
  if (out.mapping != null) { // null = absent; {} is checked (and loud if findings exist). Built over ALL specs, like the skill's mapping.
    const idsOf = (f) => (Array.isArray(f.folded_ids) && f.folded_ids.length > 0 ? f.folded_ids : Array.isArray(f.stable_ids) && f.stable_ids.length > 0 ? f.stable_ids : [stableOf(f)]).filter(Boolean).map(String);
    const want = { blocking: new Set(), questions: new Set() };
    // A resumed spec's mapping entries came from the CUT run (stale): drop them on both sides, its final findings are validated by the case itself.
    const stale = new Set();
    for (const sp of out.specs) {
      if (!usedResumed.has([sp.uc, map[sp.uc]].find((k) => k !== undefined && usedResumed.has(k)))) continue;
      for (const f of Array.isArray(sp.findings) ? sp.findings : []) for (const i of idsOf(f)) stale.add(i);
    }
    for (const sp of out.specs) if (![sp.uc, map[sp.uc]].some((k) => k !== undefined && usedResumed.has(k))) for (const f of Array.isArray(sp.findings) ? sp.findings : []) {
      const bucket = HIGH_KINDS.has(kindOf(f)) ? want.blocking : kindOf(f) === 'gap' ? want.questions : null;
      if (bucket) for (const i of idsOf(f)) bucket.add(i);
    }
    for (const k of ['blocking', 'questions']) {
      const got = new Set((Array.isArray(out.mapping?.[k]) ? out.mapping[k].map(String) : []).filter((i) => !stale.has(i)));
      const diff = [...got].filter((i) => !want[k].has(i)).concat([...want[k]].filter((i) => !got.has(i)));
      if (diff.length > 0) {
        throw new Error(`buildWreckerRecord: mapping.${k} disagrees with the findings (${diff.map((i) => tok(i)).join(', ')}) - an id only in one of them would be lost silently`);
      }
    }
  }
  return { cases, not_attacked: notAttacked, header: `mode ${tok(out.mode)}, seed ${tok(out.random_seed)}, version ${tok(out.version)}` };
}

export function buildWreckerRecord(input) {
  if (input && (input.engine === 'wrecker' || input.error || Array.isArray(input.specs))) input = fromSkill(input);
  const { cases, not_attacked = [], header = null } = input ?? {};
  if (Array.isArray(cases)) {
    for (const c of cases) {
      if (!FROM_SKILL.has(c) && c && typeof c === 'object' && ('skill' in c)) {
        throw new Error('buildWreckerRecord: a hand-written case may not carry "skill": lint-guaranteed cases come only from /wrecker:wargame output');
      }
    }
  }
  if (!Array.isArray(cases)) throw new Error('buildWreckerRecord: "cases" must be an array');
  const highMarkers = [];
  const questions = [];
  const attacked = [];
  const notAttacked = not_attacked.map((n) => `${tok(n.case)} (${oneLine(n.reason) || 'no reason given'})`);
  const seen = new Set();
  const seenOrig = new Map();
  const dropped = [];
  const derived = [];
  if (cases.length === 0) throw new Error('buildWreckerRecord: no attacked cases — an empty record would read as a pass; nothing ran');

  for (const c of cases) {
    if (!c.case) throw new Error('buildWreckerRecord: every case needs a "case" id (e.g. CU1)');
    const caseId = tok(c.case);
    const lint = c.lint;
    const src = FROM_SKILL.get(c); // 'skill' | 'resumed' | undefined
    if (!src && (!lint || typeof lint !== 'object' || !Array.isArray(lint.findings) || lint.findings.length > 0
        || typeof lint.usecase !== 'string' || !lint.usecase.trim() || typeof lint.spec_version !== 'string' || !lint.spec_version.trim()
        || lint.valid === false || (Array.isArray(lint.problems) && lint.problems.length > 0))) {
      throw new Error(`buildWreckerRecord: ${caseId} has no clean final lint (wargame_lint_spec must return 0 findings and no problems) — a run on a spec that failed lint cannot become a record`);
    }
    if (!Array.isArray(c.findings)) throw new Error(`buildWreckerRecord: ${caseId} has no "findings" array — missing findings must not read as a clean run`);
    const st = src === 'skill' ? {} : c.status;
    if (!st || typeof st !== 'object') {
      throw new Error(`buildWreckerRecord: ${caseId} carries no final session "status" — a run whose finish is not shown cannot become a record (CU7)`);
    }
    const cutHit = Array.isArray(st.guard?.hits) ? st.guard.hits.find((h) => h && h.limit !== 'max_play_steps') : undefined;
    if (cutHit || st.stop_reason === 'limit' || (st.continue_with !== undefined && st.continue_with !== null)) {
      throw new Error(`buildWreckerRecord: ${caseId}'s session was cut (${tok(cutHit?.limit ?? st.stop_reason, 'continue_with pending')}) and is not finished — resume it with resume_session_id until it finishes, or record the case as NOT attacked (CU7)`);
    }
    const findings = c.findings;
    const cov = c.coverage?.steps_reached;
    const covText = cov && cov.total !== undefined
      ? `coverage ${tok(cov.reached)}/${tok(cov.total)} steps (${tok(cov.pct)}%)`
      : 'coverage NOT REPORTED';
    const never = (Array.isArray(c.steps_never_reached) ? c.steps_never_reached : []).map((x) => tok(x));
    const counts = {};
    let seq = 0;

    for (const f of findings) {
      seq += 1;
      const kind = kindOf(f);
      counts[kind] = (counts[kind] || 0) + 1;
      const step = tok(f.step_cited);
      if (HIGH_KINDS.has(kind)) {
        // A folded entry covers several stable ids: one marker per id, so each can be RESOLVED/DEGRADED.
        const folded = [f.folded_ids, f.stable_ids].find((a) => Array.isArray(a) && a.length > 0);
        const origs = folded ? folded.map((x) => String(x)) : [stableOf(f) ?? String(f.finding_id ?? '')];
        const isStable = Boolean(folded || stableOf(f));
        for (const orig of origs) {
          // A repeated STABLE id is the same candidate: one marker is enough (judged on the ORIGINAL id,
          // never on a derived one, so two different originals can never be merged).
          if (isStable && seenOrig.has(orig.toUpperCase())) {
            const first = seenOrig.get(orig.toUpperCase());
            if (first !== orig) dropped.push(`${tok(orig)} (same as ${tok(first)} apart from case)`);
            continue;
          }
          seenOrig.set(orig.toUpperCase(), orig);
          let id = markerId({ stable_id: orig, finding_id: orig }, caseId, seq);
          // An id over the guard's length cap keeps its 12-hex digest: W-<CUn>-<12hex>.
          const hex = /([0-9a-f]{12})$/i.exec(orig);
          if (isStable && hex && orig.replace(/[^A-Za-z0-9._/-]/g, '-').length > ID_MAX) id = `W-${tok(caseId, 'X').replace(/[^A-Za-z0-9]/g, '')}-${hex[1]}`;
          // Dedup on the close guard's normalization (it upper-cases ids), so F-1 and f-1 cannot
          // become two markers that one RESOLVED closes together: collisions are made unique, never dropped.
          for (let n = 1; seen.has(id.toUpperCase()); n++) id = `${id.replace(/-x\d+$/, '').slice(0, ID_MAX - 5)}-x${n}`;
          seen.add(id.toUpperCase());
          if (isStable && id !== orig) derived.push(`${tok(orig)} -> ${id}`);
          highMarkers.push(`[FINDING-HIGH: ${id}] ${caseId} ${kind} at step ${step} (Wrecker candidate, not verified): ${oneLine(f.explanation)}`);
        }
      } else if (kind === 'gap') {
        const fids = [f.folded_ids, f.stable_ids].find((a) => Array.isArray(a) && a.length > 0);
        const idNote = fids ? ` (folded ${fids.length}: ${fids.map((x) => tok(x)).join(', ')})` : (stableOf(f) ? ` (${tok(stableOf(f))})` : '');
        questions.push(`${caseId} gap at step ${step}${idNote}: ${oneLine(f.explanation)}`);
      } else {
        throw new Error(`buildWreckerRecord: unknown finding kind "${oneLine(kind)}" in ${caseId} (${tok(f.finding_id, 'no id')}) — expected counterexample|contradiction|dead_end|gap`);
      }
    }

    const kinds = Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ') || '0 findings';
    let line = `${caseId}${c.uc && c.uc !== c.case ? ` (uc ${tok(c.uc)})` : ''} path ${tok(c.path, 'main')}: ${src ? `lint clean (guaranteed: the spec passed /wrecker:wargame's lint${src === 'resumed' ? ' before the session cut' : ''}, spec_version ${tok(c.spec_version)}, sha256 ${tok(c.spec_sha256)})` : `lint clean (spec_version ${tok(lint.spec_version)})`}; ${covText}; ${src === 'skill' ? 'no session cut shown in not_running' : `${src === 'resumed' ? 'resumed to the end: ' : ''}session finished (stop: ${tok(st.stop_reason, 'not recorded')})`}${Number(st.guard?.incomplete_plays) > 0 ? `; ${tok(st.guard.incomplete_plays)} plays cut at step ${tok(st.guard.limits?.max_play_steps ?? st.guard.hits.find((h) => h && h.limit === 'max_play_steps')?.where)}` : ''}; ${kinds}`;
    if (c.spec) line += `; spec ${tok(c.spec)}`;
    if (c.session_id) line += `; session ${tok(c.session_id)}`;
    attacked.push(line);

    if (never.length > 0) {
      const why = c.dry_run_only
        ? 'dry_run only (run_session not performed)'
        : 'not reached in the session';
      notAttacked.push(`${caseId} steps ${never.join(', ')} (${why})`);
    }
  }

  const high = highMarkers.length;
  const body = [
    `[WARGAMING] engine: wrecker${header ? ` (${header})` : ''}.`,
    `Attacked (case + path): ${attacked.join(' | ') || 'none'}.`,
    `Not attacked: ${notAttacked.join(' | ') || 'nothing declared'}.`,
    ...(derived.length > 0 ? [`Marker ids derived (original -> marker, match a later RESOLVED/DEGRADED by the marker id): ${derived.join('; ')}.`] : []),
    ...(dropped.length > 0 ? [`Stable ids folded into an earlier marker (one marker covers both): ${dropped.join('; ')}.`] : []),
    `HIGH candidates opened: ${high} (each is a separate marker comment; they block the close until triaged). Non-blocking questions for the spec owner: ${questions.length}.`,
    ...questions.map((q) => `Question for the spec owner (does not block): ${q}`),
    'Zero counterexamples proves nothing by itself: read the coverage above.',
  ].join('\n');

  return { wargaming: body, high_markers: highMarkers, questions };
}
