// upstream-classify — Phase 6 contribution helper. hivemind derives from lordiwa/agent-framework
// (MIT, the `upstream` remote). Generic "Body" improvements (orchestrator, tasks, drive-loop,
// sessions, console, plugin scaffold) are contributable back upstream; the vendored Spine + Brain
// (calibration, manifests, the brain seam, wisdom, the standards + design KB) are hivemind-specific
// and must NEVER be pushed to the third-party base. Mirrors engine-tools-mcp's upstream_classify.
//
// Classification is by PATH (a coarse but safe default). A commit touching ANY hivemind-specific
// path is MIXED → it needs a human split before contribution; it is never auto-pushed.

// Paths that are unambiguously the vendored Spine / Brain (never go upstream).
const HIVEMIND_PATTERNS = [
  /^src\/(calibration|manifest-policy|manifest-verify|brain-client|graph-sync|wisdom-sink)\.js$/,
  /^bin\/(brain-launch|check-calibration)\.js$/,
  /^scripts\/verify-manifests\.mjs$/,
  /^(skills|\.claude\/skills)\/(impl-|manifest-verifier)/,
  /^\.claude\/shared\//,         // OBSERVABILITY.md / MINIMALISM.md
  /^\.knowledge\//,              // design-of-record KB
  /^commands\/brain\.md$/,
  /^knowledge\/lessons\//,       // generated wisdom artifacts
  /^tests\/(calibration|check-calibration|manifest-policy|manifest-verify|manifest-skills|brain-client|brain-launch|graph-sync|wisdom-sink|spine-standards|drive-loop-phase6|upstream-classify)\b/,
];

/** 'hivemind' (Spine/Brain, never upstream) or 'engine' (generic, contributable). */
export function classifyPath(p) {
  return HIVEMIND_PATTERNS.some((re) => re.test(p)) ? 'hivemind' : 'engine';
}

/**
 * Classify a set of changed paths (e.g. one commit's files).
 *  - ENGINE   : all engine-generic → contributable upstream as-is
 *  - HIVEMIND : all Spine/Brain → never contributed
 *  - MIXED    : both → must be split by a human before any upstream push
 */
export function classifyFiles(paths) {
  const engine = [];
  const hivemind = [];
  for (const p of paths) (classifyPath(p) === 'hivemind' ? hivemind : engine).push(p);
  let klass;
  if (hivemind.length === 0) klass = 'ENGINE';
  else if (engine.length === 0) klass = 'HIVEMIND';
  else klass = 'MIXED';
  return { class: klass, engine, hivemind };
}

/** Build a human-readable contribution plan from per-commit file lists. */
export function contributionPlan(commits) {
  // commits: [{ sha, subject, files: string[] }]
  const classified = commits.map((c) => ({ ...c, ...classifyFiles(c.files) }));
  return {
    contributable: classified.filter((c) => c.class === 'ENGINE'),
    blocked: classified.filter((c) => c.class === 'HIVEMIND'),
    needsSplit: classified.filter((c) => c.class === 'MIXED'),
    all: classified,
  };
}
