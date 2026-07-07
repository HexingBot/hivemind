// src/framework-bug-report.js
// TASK-010 — Framework bug reporter: secret scrubbing, context collection,
// GitHub issue creation, and local fallback.
//
// All public functions accept injectable dependencies (runner, readFile, exists,
// fallbackWriter) so the full suite runs with zero disk/network I/O in tests.

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { platform, release } from 'node:os';

// ---------------------------------------------------------------------------
// scrubSecrets
// ---------------------------------------------------------------------------

const REDACT_PREFIX = '[REDACTED';

/** Ordered list of {pattern, label} substitutions applied left-to-right. */
const SECRET_PATTERNS = [
  // GitHub fine-grained PAT (longer prefix — must come before classic ghp_)
  // Loosened lower bound: `github_pat_` prefix alone is a strong signal; 20+ suffix chars
  { re: /github_pat_[A-Za-z0-9_]{20,}/g, label: 'github_pat' },
  // GitHub classic tokens
  { re: /ghp_[A-Za-z0-9]{36,}/g, label: 'ghp_token' },
  { re: /gho_[A-Za-z0-9]{36,}/g, label: 'gho_token' },
  { re: /ghs_[A-Za-z0-9]{36,}/g, label: 'ghs_token' },
  { re: /ghu_[A-Za-z0-9]{36,}/g, label: 'ghu_token' },
  { re: /ghr_[A-Za-z0-9]{36,}/g, label: 'ghr_token' },
  // Anthropic API keys (must come before generic sk-)
  { re: /sk-ant-[A-Za-z0-9\-_]{10,}/g, label: 'sk_ant_key' },
  // Modern OpenAI keys: sk-proj-..., sk-svcacct-..., sk-admin-..., and legacy sk-<chars>
  // Placed AFTER sk-ant- so Anthropic keys match their specific pattern first.
  // Allows hyphens and underscores in the body (segmented key format).
  // \b anchor prevents matching the "sk" tail of ordinary words like task-, risk-, disk-, ask-, desk-.
  { re: /\bsk-(?:proj|svcacct|admin)?-?[A-Za-z0-9_-]{20,}/g, label: 'sk_key' },
  // AWS access key IDs (AKIA* and ASIA*)
  { re: /(?:AKIA|ASIA)[A-Z0-9]{16}/g, label: 'aws_akid' },
  // Slack tokens: xoxb- (bot), xoxa- (app), xoxp- (user), xoxr- (refresh), xoxs- (socket)
  // \b anchor prevents matching if "xox" is a suffix of a longer word (e.g. myxoxb-...).
  { re: /\bxox[baprs]-[A-Za-z0-9_-]{10,}/g, label: 'slack_token' },
  // Google API keys (AIza prefix + 35 chars)
  { re: /AIza[0-9A-Za-z_-]{35}/g, label: 'google_api_key' },
  // PEM private key blocks — redact the entire block (non-greedy, bounded by END marker).
  // (?:[A-Z]+ )* matches the optional type word(s) (e.g. "RSA ", "ENCRYPTED ") before
  // "PRIVATE KEY", including the empty-string case (plain PKCS#8 "PRIVATE KEY").
  { re: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z]+ )*PRIVATE KEY-----/g, label: 'pem_private_key' },
  // URI-userinfo credentials: scheme://user:pass@host — e.g. a connection
  // string like bolt://neo4j:hunter2@db:7687. Only the credential portion
  // (between "://" and "@") is replaced; the captured scheme ($1) is kept so
  // scheme and host both stay legible for triage.
  {
    re: /(\w+:\/\/)[^/\s:@]+:[^/\s@]+@/gi,
    label: 'uri_userinfo',
    replace: (_match, scheme) => `${scheme}${REDACT_PREFIX}:uri_userinfo]@`,
  },
  // Bearer / Authorization header values — redact the token value that follows.
  // Matches: "Authorization: Bearer <token>", "Authorization: <token>",
  // or standalone "Bearer <token>" lines.
  { re: /(?:Authorization:[^\S\r\n]*(?:Bearer[^\S\r\n]*)?|Bearer[^\S\r\n]+)[A-Za-z0-9\-._~+/]+=*/gi, label: 'bearer_token' },
  // Env-var assignment patterns: FOO_TOKEN=value, BAR_SECRET="value",
  // FOO_AUTH=value, bare PASSWORD=value, etc.
  // The whole match is replaced unconditionally; no capture group is needed.
  {
    re: /\b(?:\w+_TOKEN|\w+_SECRET|\w+_KEY|\w+_PASSWORD|\w+_CREDENTIAL|\w*_AUTH|PASSWORD)\s*=\s*["']?[^\s"']{1,}["']?/gi,
    label: 'env_secret',
  },
];

/**
 * Replace known secret patterns with [REDACTED:<label>].
 * Returns a scrubbed string. Never mutates the input.
 *
 * @param {string} text
 * @returns {string}
 */
export function scrubSecrets(text) {
  let out = text;
  for (const { re, label, replace } of SECRET_PATTERNS) {
    // Most patterns use non-capturing groups only, so the whole match is
    // replaced unconditionally and no prefix leaks into the output. A pattern
    // may supply its own `replace` function (e.g. to keep a captured scheme
    // legible) — see the uri_userinfo entry above.
    out = out.replace(re, replace ?? `${REDACT_PREFIX}:${label}]`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// collectContext
// ---------------------------------------------------------------------------

/**
 * Collect a safe, secret-free context block for a bug report.
 *
 * Accepts injectable readFile and exists helpers so tests run without real I/O.
 * NEVER reads .claude/settings.json or any path that contains "settings.json".
 *
 * @param {{ pluginRoot: string, projectDir: string, readFile?: function, exists?: function }} opts
 * @returns {string}  a markdown fenced block
 */
export function collectContext({
  pluginRoot,
  projectDir,
  readFile = (p) => readFileSync(p, 'utf8'),
  exists = (p) => existsSync(p),
}) {
  // Plugin version from <pluginRoot>/.claude-plugin/plugin.json
  let pluginVersion = 'unknown';
  try {
    const pluginJsonPath = join(pluginRoot, '.claude-plugin', 'plugin.json');
    if (exists(pluginJsonPath)) {
      const manifest = JSON.parse(readFile(pluginJsonPath));
      pluginVersion = manifest.version ?? 'unknown';
    }
  } catch {
    // degraded — leave pluginVersion as 'unknown'
  }

  // Project name from PROJECT.md frontmatter
  let projectName = 'unknown';
  try {
    const projectMdPath = join(projectDir, 'PROJECT.md');
    if (exists(projectMdPath)) {
      const raw = readFile(projectMdPath);
      const m = raw.match(/^---[\s\S]*?project_name:\s*(.+?)[\s\S]*?---/m);
      if (m) projectName = m[1].trim();
    }
  } catch {
    // degraded
  }

  // Active session / task from state/session.json (key only — never body)
  let activeSession = 'none';
  let activeTask = 'none';
  try {
    const sessionPtrPath = join(projectDir, 'state', 'session.json');
    if (exists(sessionPtrPath)) {
      const ptr = JSON.parse(readFile(sessionPtrPath));
      if (ptr.active_session_id) {
        activeSession = ptr.active_session_id;
        const bundlePath = join(
          projectDir,
          'state',
          'sessions',
          ptr.active_session_id,
          'session.json',
        );
        if (exists(bundlePath)) {
          const bundle = JSON.parse(readFile(bundlePath));
          activeTask = bundle.active_task ?? 'none';
        }
      }
    }
  } catch {
    // degraded
  }

  return [
    '```',
    `plugin_version: ${pluginVersion}`,
    `os: ${platform()} ${release()}`,
    `project: ${projectName}`,
    `active_session: ${activeSession}`,
    `active_task: ${activeTask}`,
    '```',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// buildIssueBody
// ---------------------------------------------------------------------------

/**
 * Compose and scrub the complete issue body.
 *
 * Field names match the ticket ACs: observed / expected / steps / environment
 * (NOT the skill's repro/actual names).
 *
 * @param {{ title: string, observed: string, expected: string, steps: string,
 *            environment: string, severity: string, evidence?: string,
 *            context: string }} opts
 * @returns {string}  secret-scrubbed markdown body
 */
export function buildIssueBody({
  title,
  observed,
  expected,
  steps,
  environment,
  severity,
  evidence,
  context,
}) {
  const parts = [
    `## What happened\n${observed}`,
    `## What was expected\n${expected}`,
    `## Steps to reproduce\n${steps}`,
    `## Environment\n${environment}`,
    `## Severity\n${severity}`,
  ];
  if (evidence) {
    parts.push(`## Evidence\n\`\`\`\n${evidence}\n\`\`\``);
  }
  parts.push(`## Auto-collected context\n${context}`);

  const raw = parts.join('\n\n');
  return scrubSecrets(raw);
}

// ---------------------------------------------------------------------------
// detectGh
// ---------------------------------------------------------------------------

function defaultRunner(cmd, args) {
  return spawnSync(cmd, args, { encoding: 'utf8', timeout: 8_000 });
}

/**
 * Detect whether the gh CLI is available and authenticated.
 *
 * Handles the gh <= 2.42.1 exit-code bug: `gh auth status` exits 0 even when
 * not authenticated — so we also check stderr for the "not logged into" string.
 *
 * @param {function} [runner]  injectable: (cmd, args) => {status, stdout, stderr}
 * @returns {{ available: boolean, authenticated: boolean }}
 */
export function detectGh(runner = defaultRunner) {
  const ver = runner('gh', ['--version']);
  if (ver.status !== 0) return { available: false, authenticated: false };

  const auth = runner('gh', ['auth', 'status']);
  const authenticated =
    auth.status === 0 && !auth.stderr.includes('not logged into any GitHub hosts');

  return { available: true, authenticated };
}

// ---------------------------------------------------------------------------
// ghIssueCreate
// ---------------------------------------------------------------------------

/**
 * Create a GitHub issue non-interactively via the gh CLI.
 *
 * @param {{ title: string, body: string, repo: string }} opts
 * @param {function} [runner]  injectable
 * @returns {{ url: string }}
 * @throws {Error} when the gh invocation exits non-zero — message includes "exit <N>"
 */
export function ghIssueCreate({ title, body, repo }, runner = defaultRunner) {
  const result = runner('gh', [
    'issue',
    'create',
    '--repo',
    repo,
    '--title',
    title,
    '--body',
    body,
  ]);

  if (result.status !== 0) {
    throw new Error(
      `gh issue create failed (exit ${result.status}): ${result.stderr}`,
    );
  }

  // gh prints the new issue URL as the last non-empty stdout line
  const url = result.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .at(-1);

  if (!url || !url.startsWith('https://')) {
    throw new Error(`gh issue create returned unexpected output: ${result.stdout}`);
  }

  return { url };
}

// ---------------------------------------------------------------------------
// fileFrameworkBug
// ---------------------------------------------------------------------------

export const DEFAULT_REPO = 'HexingBot/hivemind';

/**
 * Top-level orchestrator: detect gh, file issue (or fall back to local file).
 *
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} opts.body          pre-built, pre-scrubbed issue body
 * @param {string} opts.pluginRoot    CLAUDE_PLUGIN_ROOT
 * @param {string} opts.projectDir    CLAUDE_PROJECT_DIR
 * @param {string} [opts.repo]        default DEFAULT_REPO ('HexingBot/hivemind')
 * @param {function} [opts.runner]    spawnSync-compatible injectable
 * @param {function} [opts.fallbackWriter]  (path, content) => void
 * @returns {Promise<{ filed: 'github'|'local', url?: string, path?: string, reason?: string }>}
 */
export async function fileFrameworkBug({
  title,
  body,
  pluginRoot,
  projectDir,
  repo = DEFAULT_REPO,
  runner = defaultRunner,
  fallbackWriter,
}) {
  // Names the actual cause of a fallback instead of a blanket
  // "unavailable/unauthenticated" guess — gh can be present and authenticated
  // and still fail `gh issue create` (wrong repo, disabled issues, etc.).
  let reason;

  try {
    const { available, authenticated } = detectGh(runner);

    if (!available) {
      reason = 'gh CLI not found';
    } else if (!authenticated) {
      reason = 'gh not authenticated';
    } else {
      try {
        const { url } = ghIssueCreate({ title, body, repo }, runner);
        return { filed: 'github', url };
      } catch (err) {
        reason = err.message;
      }
    }
  } catch (err) {
    // gh detection itself failed unexpectedly — fall through to local
    reason = err?.message ?? 'gh detection failed unexpectedly';
  }

  // Fallback: write to a local file under <projectDir>/.claude/framework-bug-reports/
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const fallbackDir = join(projectDir, '.claude', 'framework-bug-reports');
  const filePath = join(fallbackDir, `bug-report-${ts}.md`);
  const content = `# ${title}\n\n${body}\n`;

  const writer =
    fallbackWriter ??
    ((p, c) => {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, c, 'utf8');
    });

  writer(filePath, content);

  return { filed: 'local', path: filePath, reason };
}
