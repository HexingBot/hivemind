#!/usr/bin/env node

// bin/report-framework-bug.js
var import_node_url = require("node:url");

// src/framework-bug-report.js
var import_node_child_process = require("node:child_process");
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var import_node_os = require("node:os");
var REDACT_PREFIX = "[REDACTED";
var SECRET_PATTERNS = [
  // GitHub fine-grained PAT (longer prefix — must come before classic ghp_)
  // Loosened lower bound: `github_pat_` prefix alone is a strong signal; 20+ suffix chars
  { re: /github_pat_[A-Za-z0-9_]{20,}/g, label: "github_pat" },
  // GitHub classic tokens
  { re: /ghp_[A-Za-z0-9]{36,}/g, label: "ghp_token" },
  { re: /gho_[A-Za-z0-9]{36,}/g, label: "gho_token" },
  { re: /ghs_[A-Za-z0-9]{36,}/g, label: "ghs_token" },
  { re: /ghu_[A-Za-z0-9]{36,}/g, label: "ghu_token" },
  { re: /ghr_[A-Za-z0-9]{36,}/g, label: "ghr_token" },
  // Anthropic API keys (must come before generic sk-)
  { re: /sk-ant-[A-Za-z0-9\-_]{10,}/g, label: "sk_ant_key" },
  // Modern OpenAI keys: sk-proj-..., sk-svcacct-..., sk-admin-..., and legacy sk-<chars>
  // Placed AFTER sk-ant- so Anthropic keys match their specific pattern first.
  // Allows hyphens and underscores in the body (segmented key format).
  { re: /sk-(?:proj|svcacct|admin)?-?[A-Za-z0-9_-]{20,}/g, label: "sk_key" },
  // AWS access key IDs (AKIA* and ASIA*)
  { re: /(?:AKIA|ASIA)[A-Z0-9]{16}/g, label: "aws_akid" },
  // Slack tokens: xoxb- (bot), xoxa- (app), xoxp- (user), xoxr- (refresh), xoxs- (socket)
  { re: /xox[baprs]-[A-Za-z0-9_-]{10,}/g, label: "slack_token" },
  // Google API keys (AIza prefix + 35 chars)
  { re: /AIza[0-9A-Za-z_-]{35}/g, label: "google_api_key" },
  // PEM private key blocks — redact the entire block (non-greedy, bounded by END marker).
  // (?:[A-Z]+ )* matches the optional type word(s) (e.g. "RSA ", "ENCRYPTED ") before
  // "PRIVATE KEY", including the empty-string case (plain PKCS#8 "PRIVATE KEY").
  { re: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z]+ )*PRIVATE KEY-----/g, label: "pem_private_key" },
  // Bearer / Authorization header values — redact the token value that follows.
  // Matches: "Authorization: Bearer <token>", "Authorization: <token>",
  // or standalone "Bearer <token>" lines.
  { re: /(?:Authorization:[^\S\r\n]*(?:Bearer[^\S\r\n]*)?|Bearer[^\S\r\n]+)[A-Za-z0-9\-._~+/]+=*/gi, label: "bearer_token" },
  // Env-var assignment patterns: FOO_TOKEN=value, BAR_SECRET="value", etc.
  // The whole match is replaced unconditionally; no capture group is needed.
  {
    re: /\b(?:\w+_TOKEN|\w+_SECRET|\w+_KEY|\w+_PASSWORD|\w+_CREDENTIAL)\s*=\s*["']?[^\s"']{1,}["']?/gi,
    label: "env_secret"
  }
];
function scrubSecrets(text) {
  let out = text;
  for (const { re, label } of SECRET_PATTERNS) {
    out = out.replace(re, `${REDACT_PREFIX}:${label}]`);
  }
  return out;
}
function collectContext({
  pluginRoot,
  projectDir,
  readFile = (p) => (0, import_node_fs.readFileSync)(p, "utf8"),
  exists = (p) => (0, import_node_fs.existsSync)(p)
}) {
  let pluginVersion = "unknown";
  try {
    const pluginJsonPath = (0, import_node_path.join)(pluginRoot, ".claude-plugin", "plugin.json");
    if (exists(pluginJsonPath)) {
      const manifest = JSON.parse(readFile(pluginJsonPath));
      pluginVersion = manifest.version ?? "unknown";
    }
  } catch {
  }
  let projectName = "unknown";
  try {
    const projectMdPath = (0, import_node_path.join)(projectDir, "PROJECT.md");
    if (exists(projectMdPath)) {
      const raw = readFile(projectMdPath);
      const m = raw.match(/^---[\s\S]*?project_name:\s*(.+?)[\s\S]*?---/m);
      if (m) projectName = m[1].trim();
    }
  } catch {
  }
  let activeSession = "none";
  let activeTask = "none";
  try {
    const sessionPtrPath = (0, import_node_path.join)(projectDir, "state", "session.json");
    if (exists(sessionPtrPath)) {
      const ptr = JSON.parse(readFile(sessionPtrPath));
      if (ptr.active_session_id) {
        activeSession = ptr.active_session_id;
        const bundlePath = (0, import_node_path.join)(
          projectDir,
          "state",
          "sessions",
          ptr.active_session_id,
          "session.json"
        );
        if (exists(bundlePath)) {
          const bundle = JSON.parse(readFile(bundlePath));
          activeTask = bundle.active_task ?? "none";
        }
      }
    }
  } catch {
  }
  return [
    "```",
    `plugin_version: ${pluginVersion}`,
    `os: ${(0, import_node_os.platform)()} ${(0, import_node_os.release)()}`,
    `project: ${projectName}`,
    `active_session: ${activeSession}`,
    `active_task: ${activeTask}`,
    "```"
  ].join("\n");
}
function buildIssueBody({
  title,
  observed,
  expected,
  steps,
  environment,
  severity,
  evidence,
  context
}) {
  const parts = [
    `## What happened
${observed}`,
    `## What was expected
${expected}`,
    `## Steps to reproduce
${steps}`,
    `## Environment
${environment}`,
    `## Severity
${severity}`
  ];
  if (evidence) {
    parts.push(`## Evidence
\`\`\`
${evidence}
\`\`\``);
  }
  parts.push(`## Auto-collected context
${context}`);
  const raw = parts.join("\n\n");
  return scrubSecrets(raw);
}
function defaultRunner(cmd, args) {
  return (0, import_node_child_process.spawnSync)(cmd, args, { encoding: "utf8", timeout: 8e3 });
}
function detectGh(runner = defaultRunner) {
  const ver = runner("gh", ["--version"]);
  if (ver.status !== 0) return { available: false, authenticated: false };
  const auth = runner("gh", ["auth", "status"]);
  const authenticated = auth.status === 0 && !auth.stderr.includes("not logged into any GitHub hosts");
  return { available: true, authenticated };
}
function ghIssueCreate({ title, body, repo }, runner = defaultRunner) {
  const result = runner("gh", [
    "issue",
    "create",
    "--repo",
    repo,
    "--title",
    title,
    "--body",
    body
  ]);
  if (result.status !== 0) {
    throw new Error(
      `gh issue create failed (exit ${result.status}): ${result.stderr}`
    );
  }
  const url = result.stdout.trim().split("\n").filter(Boolean).at(-1);
  if (!url || !url.startsWith("https://")) {
    throw new Error(`gh issue create returned unexpected output: ${result.stdout}`);
  }
  return { url };
}
var DEFAULT_REPO = "lordiwa/agent-framework";
async function fileFrameworkBug({
  title,
  body,
  pluginRoot,
  projectDir,
  repo = DEFAULT_REPO,
  runner = defaultRunner,
  fallbackWriter
}) {
  try {
    const { available, authenticated } = detectGh(runner);
    if (available && authenticated) {
      const { url } = ghIssueCreate({ title, body, repo }, runner);
      return { filed: "github", url };
    }
  } catch {
  }
  const ts = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const fallbackDir = (0, import_node_path.join)(projectDir, ".claude", "framework-bug-reports");
  const filePath = (0, import_node_path.join)(fallbackDir, `bug-report-${ts}.md`);
  const content = `# ${title}

${body}
`;
  const writer = fallbackWriter ?? ((p, c) => {
    (0, import_node_fs.mkdirSync)((0, import_node_path.dirname)(p), { recursive: true });
    (0, import_node_fs.writeFileSync)(p, c, "utf8");
  });
  writer(filePath, content);
  return { filed: "local", path: filePath };
}

// bin/report-framework-bug.js
var import_meta = {};
var SINGLE_FLAGS = /* @__PURE__ */ new Set([
  "--title",
  "--observed",
  "--expected",
  "--steps",
  "--environment",
  "--severity",
  "--evidence",
  "--plugin-root",
  "--project-dir",
  "--repo"
]);
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!SINGLE_FLAGS.has(flag)) {
      throw new Error(`unknown flag: ${flag}`);
    }
    const value = argv[++i];
    if (value === void 0) throw new Error(`flag ${flag} requires a value`);
    const key = flag.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    out[key] = value;
  }
  return out;
}
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const {
    title,
    observed,
    expected,
    steps,
    environment,
    severity,
    evidence,
    pluginRoot = process.env.CLAUDE_PLUGIN_ROOT ?? process.cwd(),
    projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
    repo
  } = args;
  const missing = ["title", "observed", "expected", "steps", "environment", "severity"].filter((k) => !args[k]);
  if (missing.length > 0) {
    throw new Error(`Missing required flags: ${missing.map((k) => `--${k}`).join(", ")}`);
  }
  const context = collectContext({ pluginRoot, projectDir });
  const body = buildIssueBody({
    title,
    observed,
    expected,
    steps,
    environment,
    severity,
    evidence,
    context
  });
  const result = await fileFrameworkBug({
    title,
    body,
    pluginRoot,
    projectDir,
    ...repo ? { repo } : {}
  });
  if (result.filed === "github") {
    console.log(`Filed framework bug on GitHub: ${result.url}`);
  } else {
    console.log(`gh unavailable/unauthenticated. Bug report saved locally: ${result.path}`);
  }
}
var __isEntry = import_meta.url ? Boolean(process.argv[1]) && import_meta.url === (0, import_node_url.pathToFileURL)(process.argv[1]).href : typeof require !== "undefined" && typeof module !== "undefined" && require.main === module;
if (__isEntry) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
