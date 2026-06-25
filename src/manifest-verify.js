// manifest-verify — deterministic cross-manifest coverage checks, ported from
// implementation-engine/scripts/verify_manifests.mjs. This is the OBJECTIVE leg of the spec
// loop (distinct from the judgement-based reviewer): checkable invariants only, no taste.
//
// The check functions are pure over content strings (paths are the CLI's job —
// scripts/verify-manifests.mjs), so every invariant is unit-testable without a project on disk.
// Each check returns { name, pass, details }. See PLAN.md Phase 3 (P3.3) + the manifest-verifier skill.

const uniq = (a) => [...new Set(a)];
const matchAll = (s, re) => (s ? uniq([...s.matchAll(re)].map((m) => m[1])) : []);

const GAP_RE = /\b(G-[A-Z0-9-]*\d|GT-[A-Z0-9-]*\d)\b/g;

/**
 * Run the six invariants over manifest + context content. Every argument is optional; a check
 * whose inputs are absent is reported as a non-failing "skipped". Returns an array of checks.
 */
export function runChecks({
  scope, estimation, gaps,
  screens, contracts, states, blockTasks, componentCatalog, projectStructure,
  verifyDoc = '',
} = {}) {
  const checks = [];
  const add = (name, pass, details = '') => checks.push({ name, pass, details });

  // 1. Scope items -> screens
  if (scope && screens) {
    const ids = matchAll(scope, /\b(S-[A-Z0-9]+)\b/g);
    const missing = ids.filter((id) => !screens.includes(id));
    add('Scope -> screens', missing.length === 0,
      missing.length ? `missing in SCREEN_SPECS: ${missing.join(', ')}` : `${ids.length} scope items covered`);
  } else {
    add('Scope -> screens', true, 'skipped (scope or SCREEN_SPECS absent)');
  }

  // 2. Blocks -> tasks
  if (estimation && blockTasks) {
    const ids = matchAll(estimation, /\b(B-\d{2})\b/g);
    const missing = ids.filter((id) => !blockTasks.includes(id));
    add('Blocks -> tasks', missing.length === 0,
      missing.length ? `missing in BLOCK_TASKS: ${missing.join(', ')}` : `${ids.length} blocks covered`);
  } else {
    add('Blocks -> tasks', true, 'skipped (estimation or BLOCK_TASKS absent)');
  }

  // 3. Screen endpoints -> contracts
  if (screens && contracts) {
    const epRe = /\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[^\s`)\]]*)/g;
    const eps = uniq([...screens.matchAll(epRe)].map((m) => `${m[1]} ${m[2]}`));
    const orphans = eps.filter((ep) => {
      const path = ep.split(' ')[1].split('?')[0]; // strip query string — same endpoint
      return !contracts.includes(path);
    });
    add('Screen endpoints -> contracts', orphans.length === 0,
      orphans.length ? `not in API_CONTRACTS: ${orphans.join(', ')}` : `${eps.length} endpoints matched`);
  } else {
    add('Screen endpoints -> contracts', true, 'skipped (SCREEN_SPECS or API_CONTRACTS absent)');
  }

  // 4. Gap references valid
  if (gaps) {
    const known = new Set(matchAll(gaps, GAP_RE));
    const referenced = uniq(
      [screens, contracts, states, blockTasks, componentCatalog, projectStructure]
        .filter(Boolean)
        .flatMap((doc) => matchAll(doc, GAP_RE)),
    );
    const dangling = referenced.filter((id) => !known.has(id));
    add('Gap references valid', dangling.length === 0,
      dangling.length ? `referenced but not in gaps: ${dangling.join(', ')}` : `${referenced.length} gap refs valid`);
  } else {
    add('Gap references valid', true, 'skipped (gaps absent)');
  }

  // 5. MISSING_INFO traced — every [MISSING_INFO] carries a gap id, or is logged in VERIFY.md
  {
    let untraced = 0;
    for (const doc of [screens, contracts, states, blockTasks].filter(Boolean)) {
      for (const line of doc.split('\n')) {
        if (line.includes('[MISSING_INFO]') && !new RegExp(GAP_RE.source).test(line)) untraced++;
      }
    }
    const pass = untraced === 0 || verifyDoc.includes('[MISSING_INFO]');
    add('MISSING_INFO traced', pass,
      untraced === 0 ? 'none untraced' : `${untraced} [MISSING_INFO] without a gap id (log them in reviews/VERIFY.md)`);
  }

  // 6. Cache/query key parity
  if (contracts && states) {
    const keyRoot = (doc) => uniq([...doc.matchAll(/\[\s*"([^"]+)"/g)].map((m) => m[1]));
    const cacheKeys = keyRoot(contracts);
    const queryKeys = keyRoot(states);
    const drift = cacheKeys.filter((k) => queryKeys.length > 0 && !queryKeys.includes(k));
    add('Cache/query key parity', drift.length === 0,
      drift.length ? `cache keys with no STATE_SCHEMAS query key: ${drift.join(', ')}` : `${cacheKeys.length} key roots aligned`);
  } else {
    add('Cache/query key parity', true, 'skipped (API_CONTRACTS or STATE_SCHEMAS absent)');
  }

  return checks;
}

/** Overall pass/fail + the failing checks. */
export function summarize(checks) {
  const failed = checks.filter((c) => !c.pass);
  return { ok: failed.length === 0, failed };
}

/** Render the coverage matrix (the `reviews/VERIFY.md` body). `now` is injected for determinism. */
export function buildMatrix(checks, { now } = {}) {
  const { ok } = summarize(checks);
  const stamp = now ? ` (generated ${now})` : '';
  const rows = checks.map((c) => `| ${c.name} | ${c.pass ? 'PASS' : 'FAIL'} | ${c.details} |`).join('\n');
  return [
    '# Verification Matrix',
    '',
    `**Result**: ${ok ? 'PASS' : 'FAIL'}${stamp}`,
    '',
    '| Check | Result | Details |',
    '|-------|--------|---------|',
    rows,
    '',
  ].join('\n');
}
