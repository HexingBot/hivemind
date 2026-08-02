// src/backlog-seeder.js
// TASK-014 — generate a small starter backlog from intake answers.
//
// Called by bin/init.js after generateProjectContext succeeds in the
// created / forced / resumed branches (NOT already_initialized). Reads
// `answers.primary_use_cases` (string or array) and mints:
//   - every template in COMMON_TEMPLATES (independent of use cases), and
//   - every template in USE_CASE_TEMPLATES[uc] for each selected use case.
//
// Idempotency: if any existing ticket already carries the literal `seed`
// label, seedBacklog returns {created: []} without writing. This is one-shot
// per project: re-seeding after the user has started work would either
// duplicate identical-title tickets or clobber in-progress status. `--force`
// re-runs of bin/init.js therefore do NOT re-seed.
//
// Every minted ticket:
//   - labels: ['seed', ...template.labels ?? []]
//   - opening comment from author 'backlog-seeder' whose body names either
//     the triggering use case (substring match) or the literal string 'common'.
//
// Hard constraint: the comment body for COMMON_TEMPLATES tickets must NOT
// incidentally contain a use-case slug (the test partitions tickets by
// substring match — overlap would mis-attribute commons to a use case).
//
// TASK-165 — HUMAN SCOPE DECISION (2026-07-18): mint-a-plan, NOT filter/
// reword and NOT generate-from-prose. When the discovery-first definition
// captured at intake (problem_statement / goals / scope_in / scope_out — see
// src/question-library.js COMMON_QUESTIONS) is non-empty, seedBacklog mints
// exactly ONE additional 'Draft an implementation plan against the stated
// goals/scope' ticket (see buildPlanTemplate). The prose is passed through
// VERBATIM (problem_statement) or via a pure string join (goals/scope_in/
// scope_out) — no LLM generation — so the seeder stays deterministic and
// fixture-testable. An entirely empty definition mints nothing extra
// (back-compat with definition-less inits).

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { createTask, appendComment, TASK_FILENAME_RE } from './task-store.js';

/**
 * Module-top template catalogs. Frozen at the leaf level so a stray mutation
 * in user code surfaces immediately rather than corrupting later seed runs.
 */

export const COMMON_TEMPLATES = Object.freeze([
  Object.freeze({
    title: 'Set up project CI',
    description:
      'Wire up a basic continuous-integration pipeline that runs the test ' +
      'suite and the linter on every push and pull request. This is the ' +
      'first piece of automation every fresh project needs.',
    acceptance_criteria: Object.freeze([
      'CI pipeline runs the full test suite on every push to the default branch.',
      'CI pipeline runs the linter and fails the build on any lint error.',
      'CI status is visible from the repository host (badge or required check).',
    ]),
    priority: 'high',
    labels: Object.freeze(['ci']),
  }),
]);

export const USE_CASE_TEMPLATES = Object.freeze({
  'data-entry': Object.freeze([
    Object.freeze({
      title: 'Define data input schema',
      description:
        'Document the structure and constraints of every input form / API ' +
        'payload the application accepts. Drives validation layer design.',
      acceptance_criteria: Object.freeze([
        'Each input surface has a named schema (e.g. JSON Schema or equivalent).',
        'Required vs optional fields are explicit for every field.',
      ]),
      priority: 'high',
      labels: Object.freeze(['schema']),
    }),
    Object.freeze({
      title: 'Add input validation layer',
      description:
        'Implement a centralized validation step so every user-supplied ' +
        'payload is rejected with a clear error before reaching business logic.',
      acceptance_criteria: Object.freeze([
        'Invalid payloads return a structured 4xx error naming the failed field.',
        'Validation runs before any database write.',
      ]),
      priority: 'medium',
      labels: Object.freeze(['validation']),
    }),
  ]),
  'reporting': Object.freeze([
    Object.freeze({
      title: 'Define report data sources',
      description:
        'Inventory the tables, APIs, and event streams that feed reports. ' +
        'Without this catalog, report endpoints accumulate ad-hoc joins.',
      acceptance_criteria: Object.freeze([
        'Each report has a documented data source list.',
        'Source freshness expectations (real-time vs daily) are recorded.',
      ]),
      priority: 'high',
      labels: Object.freeze(['data-model']),
    }),
    Object.freeze({
      title: 'Build first report endpoint',
      description:
        'Ship one end-to-end report so the rest of the reporting stack has ' +
        'a working reference implementation to follow.',
      acceptance_criteria: Object.freeze([
        'Endpoint returns a documented JSON or CSV payload.',
        'Endpoint is covered by at least one integration test.',
      ]),
      priority: 'medium',
      labels: Object.freeze(['endpoint']),
    }),
  ]),
  'integration': Object.freeze([
    Object.freeze({
      title: 'Document upstream APIs',
      description:
        'For every external system this project talks to, capture base URL, ' +
        'auth, rate limits, and failure modes in one place.',
      acceptance_criteria: Object.freeze([
        'Each upstream has a documented base URL and auth scheme.',
        'Known rate limits and retry policies are recorded.',
      ]),
      priority: 'high',
      labels: Object.freeze(['docs']),
    }),
    Object.freeze({
      title: 'Add integration test harness',
      description:
        'Set up a harness that exercises real (or recorded) upstream calls ' +
        'so contract drift surfaces in CI rather than in production.',
      acceptance_criteria: Object.freeze([
        'At least one integration test exists and runs in CI.',
        'Harness supports either live calls or recorded fixtures behind a flag.',
      ]),
      priority: 'medium',
      labels: Object.freeze(['testing']),
    }),
  ]),
  'automation': Object.freeze([
    Object.freeze({
      title: 'Identify trigger source',
      description:
        'Pin down what fires the automation: cron, webhook, queue message, ' +
        'or manual. Trigger choice constrains the whole runtime shape.',
      acceptance_criteria: Object.freeze([
        'Trigger mechanism is documented (cron expression, event topic, etc.).',
        'Expected invocation frequency is recorded.',
      ]),
      priority: 'high',
      labels: Object.freeze(['design']),
    }),
    Object.freeze({
      title: 'Add idempotency guard',
      description:
        'Automations re-run. Add the de-duplication mechanism (job id, ' +
        'natural key, etc.) so duplicate firings are no-ops.',
      acceptance_criteria: Object.freeze([
        'Re-running the automation with the same input produces no side effects.',
        'Idempotency key strategy is documented.',
      ]),
      priority: 'medium',
      labels: Object.freeze(['reliability']),
    }),
  ]),
  'collaboration': Object.freeze([
    Object.freeze({
      title: 'Define user roles and permissions',
      description:
        'Enumerate the roles (admin, editor, viewer, etc.) and the actions ' +
        'each one may take. Drives the authorization layer.',
      acceptance_criteria: Object.freeze([
        'Role list is documented with at least one capability per role.',
        'A permission matrix maps roles to allowed actions.',
      ]),
      priority: 'high',
      labels: Object.freeze(['authz']),
    }),
    Object.freeze({
      title: 'Add audit log',
      description:
        'Persist a tamper-resistant log of who did what when. Required for ' +
        'any multi-user product handling non-trivial data.',
      acceptance_criteria: Object.freeze([
        'Every state-changing action writes an audit entry with actor + timestamp.',
        'Audit log is queryable by actor and by target resource.',
      ]),
      priority: 'medium',
      labels: Object.freeze(['audit']),
    }),
  ]),
  'other': Object.freeze([
    Object.freeze({
      title: 'Define initial milestone',
      description:
        'The project type is open-ended. Pick the first measurable milestone ' +
        'and write down what shipping it means.',
      acceptance_criteria: Object.freeze([
        'Milestone has a one-sentence definition of done.',
        'Milestone has at least one verifiable success criterion.',
      ]),
      priority: 'high',
      labels: Object.freeze(['planning']),
    }),
  ]),
});

/**
 * Local synchronous mirror of src/task-store.js#readAllTasks. Uses the
 * TASK_FILENAME_RE regex imported from src/task-store.js (TASK-017 AC7) so
 * the seeder and the store agree on what counts as a task file. Kept local
 * (rather than promoted to task-store's public API) because the seeder is
 * the only consumer of the synchronous variant.
 */
function readAllTasksSync(repoRoot) {
  const dir = join(repoRoot, 'tasks');
  if (!existsSync(dir)) return [];
  // TASK-017 AC7 — share TASK_FILENAME_RE with src/task-store.js so the seeder
  // and the store agree on what counts as a task file. The previous filter
  // (suffix check plus two filename exclusions) would happily admit a stray
  // `notes.json`, which then crashed the JSON.parse inside the read loop with
  // a silently-swallowed error.
  const names = readdirSync(dir).filter((n) => TASK_FILENAME_RE.test(n));
  // TASK-017 AC4 — readdirSync returns filesystem-dependent order (Windows vs
  // POSIX differ). The idempotency guard short-circuits on the first
  // `seed`-labeled match, but the guard's correctness is independent of the
  // readdirSync iteration order: any seed-labeled prior ticket blocks the
  // re-seed regardless of which one we encounter first.
  const out = [];
  for (const name of names) {
    const filePath = join(dir, name);
    let raw;
    try {
      raw = readFileSync(filePath, 'utf8');
    } catch (err) {
      // ENOENT is tolerated — the file was removed between readdirSync and
      // readFileSync (concurrent cleanup). Any other read error propagates.
      if (err && err.code === 'ENOENT') continue;
      throw err;
    }
    // TASK-017 AC3 — propagate JSON.parse errors with the offending filename
    // so the user can locate the corruption. The previous silent catch could
    // mask a corrupt prior-seed ticket and let the seeder re-mint duplicates.
    try {
      out.push(JSON.parse(raw));
    } catch (err) {
      throw new Error(
        `backlog-seeder: failed to parse task file ${name}: ${err.message}`,
      );
    }
  }
  return out;
}

/**
 * Normalize answers.primary_use_cases to an array of strings. Accepts:
 *   - undefined / null / ''     -> []
 *   - 'data-entry'              -> ['data-entry']
 *   - ['data-entry','reporting']-> ['data-entry', 'reporting']
 *
 * Anything else (number, object, etc.) -> [] (defensive — empty case
 * still yields the common starter, so the user is never left empty-handed).
 */
function normalizeUseCases(raw) {
  if (Array.isArray(raw)) {
    return raw.filter((v) => typeof v === 'string' && v.length > 0);
  }
  if (typeof raw === 'string' && raw.length > 0) {
    // TASK-017 AC2 — split CSV strings on ',' and trim. The question engine
    // already pre-splits multi-select input before it reaches the seeder, but
    // direct callers (scripts, replay tooling, hand-edited intake.json) can
    // pass the raw CSV. Splitting here keeps both paths convergent on the
    // array shape that the per-use-case loop expects.
    if (raw.includes(',')) {
      return raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
    return [raw];
  }
  return [];
}

/**
 * TASK-165 — normalize a definition-list answer (goals/scope_in/scope_out) to
 * an array of non-empty trimmed strings. Mirrors bin/init.js's
 * normalizeDefinitionAnswers list-handling so a direct caller that hasn't gone
 * through that normalization (script, hand-edited intake.json) still gets
 * consistent behavior: array passthrough (trim + drop empties), or a
 * comma-separated string split the same way normalizeUseCases splits
 * primary_use_cases above.
 */
function normalizeDefinitionList(raw) {
  if (Array.isArray(raw)) {
    return raw.map((s) => (typeof s === 'string' ? s.trim() : String(s))).filter(Boolean);
  }
  if (typeof raw === 'string' && raw.length > 0) {
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

/**
 * TASK-165 — build the single 'implementation plan' ticket template from the
 * captured discovery-first definition. Returns null when the ENTIRE
 * definition is empty (AC2 — back-compat with definition-less inits).
 *
 * Deterministic by construction: problem_statement is copied VERBATIM;
 * goals/scope_in/scope_out are folded in via a pure `Array#join` — no
 * generated prose, no randomness, no timestamp. Identical `answers` therefore
 * always yield a byte-identical template (AC3).
 */
function buildPlanTemplate(answers) {
  const problemStatement =
    answers && typeof answers.problem_statement === 'string' ? answers.problem_statement : '';
  const goals = normalizeDefinitionList(answers && answers.goals);
  const scopeIn = normalizeDefinitionList(answers && answers.scope_in);
  const scopeOut = normalizeDefinitionList(answers && answers.scope_out);

  const hasDefinition =
    problemStatement.trim().length > 0 ||
    goals.length > 0 ||
    scopeIn.length > 0 ||
    scopeOut.length > 0;
  if (!hasDefinition) return null;

  // problem_statement is embedded VERBATIM (no trimming, no rewording) — AC1.
  const description = [
    'Draft an implementation plan against the stated goals/scope before any ' +
      'implementation ticket for this project starts.',
    '',
    'Problem statement (captured verbatim at intake):',
    problemStatement.trim().length > 0 ? problemStatement : '(none captured at intake)',
  ].join('\n');

  const acceptance_criteria = [
    goals.length > 0
      ? `Plan explicitly addresses every stated goal: ${goals.join('; ')}`
      : 'Plan explicitly addresses the stated goals (none captured at intake).',
    scopeIn.length > 0
      ? `Plan stays within the stated in-scope items: ${scopeIn.join('; ')}`
      : 'Plan stays within the stated in-scope items (none captured at intake).',
  ];
  if (scopeOut.length > 0) {
    acceptance_criteria.push(
      `Plan explicitly excludes the stated out-of-scope items: ${scopeOut.join('; ')}`,
    );
  }
  acceptance_criteria.push(
    'Plan is recorded as a ticket comment or linked doc before any implementation ticket for this project starts.',
  );

  return Object.freeze({
    title: 'Draft an implementation plan against the stated goals/scope',
    description,
    acceptance_criteria: Object.freeze(acceptance_criteria),
    priority: 'high',
    labels: Object.freeze(['plan']),
    // uat-only: the plan itself is glue/prose, verified conversationally
    // rather than via new specs (see CLAUDE.md verification-tier rubric).
    verification_tier: 'uat-only',
  });
}

/**
 * Mint a single seeded ticket from a template + a triggering tag ('common' or
 * a use-case slug). Returns the new ticket key.
 *
 * For the 'common' tag and a use-case slug tag, the opening comment body MUST
 * contain the literal `tag` substring (the test's commentNamesUseCase helper
 * does String.includes(tag) to partition minted tickets by trigger). Phrasing
 * is deliberately anodyne for the 'common' case so no incidental use-case
 * slug appears in the body. The 'plan' tag (TASK-165) is the one exception to
 * this invariant — its body is deliberately free of the literal substring
 * "plan" (see the tag === 'plan' branch below), so this invariant is scoped
 * to the common/use-case tags only, not every tag mintTicket accepts.
 *
 * TASK-017 AC6 — callers MUST await mintTicket sequentially (one ticket per
 * iteration, never Promise.all over the templates). The atomic-write key
 * derivation inside createTask reads the current max TASK-NNN from disk and
 * writes TASK-(NNN+1); a parallel mint would race that read and produce
 * duplicate or non-monotonic keys. Serialization here is deliberate.
 */
async function mintTicket({ repoRoot, template, tag, now }) {
  const labels = Array.from(
    new Set(['seed', ...(Array.isArray(template.labels) ? template.labels : [])]),
  );
  const { key } = await createTask({
    repoRoot,
    title: template.title,
    description: template.description,
    acceptance_criteria: [...template.acceptance_criteria],
    priority: template.priority,
    labels,
    // TASK-165 — template.verification_tier is undefined for
    // COMMON_TEMPLATES/USE_CASE_TEMPLATES entries (createTask omits the field
    // when undefined) and 'uat-only' for the plan template.
    verification_tier: template.verification_tier,
    now,
  });
  // Body is lowercase-prefixed so the test's case-sensitive String.includes
  // matcher (substring contract) lights up. Common bodies must NOT contain
  // any use-case slug — keep the phrasing anodyne. The 'plan' tag (TASK-165)
  // is likewise kept free of use-case slugs / the literal 'common'.
  const body =
    tag === 'common'
      ? 'common starter ticket — applies to every fresh project'
      : tag === 'plan'
        ? 'derived from the captured problem/goals/scope definition at intake'
        : `Triggered by primary_use_case: ${tag}`;
  await appendComment({
    repoRoot,
    key,
    author: 'backlog-seeder',
    body,
    now,
  });
  return key;
}

/**
 * Public entrypoint. See file header for full contract.
 *
 * @param {object} opts
 * @param {string} opts.repoRoot
 * @param {object} opts.answers
 * @param {() => string} [opts.now]
 * @returns {Promise<{created: string[]}>}
 */
export async function seedBacklog({
  repoRoot,
  answers,
  now = () => new Date().toISOString(),
}) {
  // ---- Step 1: idempotency guard ----
  const existing = readAllTasksSync(repoRoot);
  for (const t of existing) {
    if (Array.isArray(t.labels) && t.labels.includes('seed')) {
      return { created: [] };
    }
  }

  // ---- Step 2: normalize ----
  const useCases = normalizeUseCases(answers && answers.primary_use_cases);

  // tasks/ is self-bootstrapped by createTask (TASK-009 AC7) — no mkdir here.

  const created = [];

  // ---- Step 3: common starter(s) ----
  for (const tpl of COMMON_TEMPLATES) {
    const key = await mintTicket({ repoRoot, template: tpl, tag: 'common', now });
    created.push(key);
  }

  // ---- Step 4: per-use-case ----
  // TASK-017 AC1 — collapse duplicate use-case slugs via `new Set` BEFORE the
  // per-template loop. The question engine de-duplicates multi-select input,
  // but a direct caller (scripts, hand-edited intake.json) can pass
  // duplicates; without this, each template would mint twice.
  for (const uc of new Set(useCases)) {
    const templates = USE_CASE_TEMPLATES[uc];
    // TASK-017 AC2 design lock: split-CSV in normalizeUseCases is the
    // canonical entry path; unknown slugs reach here only via direct-caller
    // misuse (hand-edited intake.json, scripts) — silently ignore.
    if (!templates) continue;
    for (const tpl of templates) {
      // TASK-017 AC6 — sequential await is deliberate. Parallelizing the mint
      // would race the monotonic-key derivation inside createTask's
      // atomic-write step. Do not refactor to Promise.all.
      const key = await mintTicket({ repoRoot, template: tpl, tag: uc, now });
      created.push(key);
    }
  }

  // ---- Step 5: implementation-plan ticket (TASK-165) ----
  // Mints at most ONE additional ticket carrying the captured discovery-first
  // definition. Skipped entirely when the definition is empty (AC2).
  const planTemplate = buildPlanTemplate(answers);
  if (planTemplate) {
    const key = await mintTicket({ repoRoot, template: planTemplate, tag: 'plan', now });
    created.push(key);
  }

  return { created };
}
