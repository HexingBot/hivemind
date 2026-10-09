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

function markerId(f, caseId, seq) {
  const clean = String(f.finding_id ?? '').replace(/[^A-Za-z0-9._/-]/g, '-');
  if (/[A-Za-z0-9]/.test(clean) && clean.length <= ID_MAX) return clean;
  return fallbackId(caseId, seq);
}

export function buildWreckerRecord({ cases, not_attacked = [] }) {
  if (!Array.isArray(cases)) throw new Error('buildWreckerRecord: "cases" must be an array');
  const highMarkers = [];
  const questions = [];
  const attacked = [];
  const notAttacked = not_attacked.map((n) => `${tok(n.case)} (${oneLine(n.reason) || 'no reason given'})`);
  const seen = new Set();
  if (cases.length === 0) throw new Error('buildWreckerRecord: no attacked cases — an empty record would read as a pass; nothing ran');

  for (const c of cases) {
    if (!c.case) throw new Error('buildWreckerRecord: every case needs a "case" id (e.g. CU1)');
    const caseId = tok(c.case);
    const lint = c.lint;
    if (!lint || typeof lint !== 'object' || !Array.isArray(lint.findings) || lint.findings.length > 0
        || typeof lint.usecase !== 'string' || !lint.usecase.trim() || typeof lint.spec_version !== 'string' || !lint.spec_version.trim()
        || lint.valid === false || (Array.isArray(lint.problems) && lint.problems.length > 0)) {
      throw new Error(`buildWreckerRecord: ${caseId} has no clean final lint (wargame_lint_spec must return 0 findings and no problems) — a run on a spec that failed lint cannot become a record`);
    }
    if (!Array.isArray(c.findings)) throw new Error(`buildWreckerRecord: ${caseId} has no "findings" array — missing findings must not read as a clean run`);
    const st = c.status;
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
        let id = markerId(f, caseId, seq);
        // Dedup on the close guard's normalization (it upper-cases ids), so F-1 and f-1 cannot
        // become two markers that one RESOLVED closes together.
        for (let n = 0; seen.has(id.toUpperCase()); n++) id = `${fallbackId(caseId, seq).slice(0, ID_MAX - 3)}${n ? `-${n}` : ''}`;
        seen.add(id.toUpperCase());
        highMarkers.push(`[FINDING-HIGH: ${id}] ${caseId} ${kind} at step ${step} (Wrecker candidate, not verified): ${oneLine(f.explanation)}`);
      } else if (kind === 'gap') {
        questions.push(`${caseId} gap at step ${step}: ${oneLine(f.explanation)}`);
      } else {
        throw new Error(`buildWreckerRecord: unknown finding kind "${oneLine(kind)}" in ${caseId} (${tok(f.finding_id, 'no id')}) — expected counterexample|contradiction|dead_end|gap`);
      }
    }

    const kinds = Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ') || '0 findings';
    let line = `${caseId} path ${tok(c.path, 'main')}: lint clean (spec_version ${tok(lint.spec_version)}); ${covText}; session finished (stop: ${tok(st.stop_reason, 'not recorded')})${Number(st.guard?.incomplete_plays) > 0 ? `; ${tok(st.guard.incomplete_plays)} plays cut at step ${tok(st.guard.hits.find((h) => h && h.limit === 'max_play_steps')?.where ?? st.guard.limits?.max_play_steps)}` : ''}; ${kinds}`;
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
    '[WARGAMING] engine: wrecker.',
    `Attacked (case + path): ${attacked.join(' | ') || 'none'}.`,
    `Not attacked: ${notAttacked.join(' | ') || 'nothing declared'}.`,
    `HIGH candidates opened: ${high} (each is a separate marker comment; they block the close until triaged). Non-blocking questions for the spec owner: ${questions.length}.`,
    ...questions.map((q) => `Question for the spec owner (does not block): ${q}`),
    'Zero counterexamples proves nothing by itself: read the coverage above.',
  ].join('\n');

  return { wargaming: body, high_markers: highMarkers, questions };
}
