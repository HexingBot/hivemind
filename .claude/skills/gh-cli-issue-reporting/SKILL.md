---
name: gh-cli-issue-reporting
description: >
  Load this skill when writing code that creates GitHub issues via the `gh` CLI,
  when implementing auth-detection logic before a `gh` invocation, when scrubbing
  secrets from a body that will be submitted to a public GitHub repository, or when
  designing a local-file fallback for offline / unauthenticated environments.
  Triggers: any file named *report-framework-bug*, *gh-report*, *file-issue*,
  or any code calling `spawnSync('gh', ...)` / `execSync('gh issue create ...')`.
---

# gh CLI Issue Reporting — Team Skill

## When to Use This Skill

Use when implementing the `/hivemind:report-framework-bug` command or any
future feature that files GitHub issues from within a Claude Code plugin. Core topics:
auth detection, non-interactive issue creation, secret scrubbing before upload,
and the local-file durable fallback.

## Core Workflows

### 1. Detect whether gh is available and authenticated

Run two cheap checks in sequence. Either failure means fall back to the local file.

```js
import { spawnSync } from 'node:child_process';

/**
 * @param {function} runner  injectable for tests: (cmd, args) => {status, stdout, stderr}
 * @returns {{ available: boolean, authenticated: boolean }}
 */
export function detectGh(runner = defaultRunner) {
  // Step 1 — is the binary present?
  const ver = runner('gh', ['--version']);
  if (ver.status !== 0) return { available: false, authenticated: false };

  // Step 2 — is at least one account authenticated?
  // gh auth status exits 0 when any account is logged in, 1 otherwise.
  // KNOWN CAVEAT: gh <= 2.42.1 always exits 0 from `auth status`.
  // Mitigation: also check stderr for "not logged into any GitHub hosts".
  const auth = runner('gh', ['auth', 'status']);
  const authOk =
    auth.status === 0 &&
    !auth.stderr.includes('not logged into any GitHub hosts');
  return { available: true, authenticated: authOk };
}

function defaultRunner(cmd, args) {
  return spawnSync(cmd, args, { encoding: 'utf8', timeout: 8_000 });
}
```

**Pitfall — `gh auth status` exit-code bug.** Versions of gh up to 2.42.1 return
exit code 0 even when not authenticated. Always combine the exit-code check with the
stderr string check above so the guard works on those versions.

**Pitfall — 8-second timeout.** Claude Code desktop has had issues where
`gh auth status` blocks for ~5 s on flaky network. Use `timeout: 8_000` to avoid
hanging the command.

### 2. Create an issue non-interactively

```js
/**
 * @param {{ title: string, body: string, repo: string }} opts
 * @param {function} runner  injectable
 * @returns {{ url: string }}   the new issue URL, e.g. https://github.com/owner/repo/issues/42
 */
export function ghIssueCreate({ title, body, repo }, runner = defaultRunner) {
  const result = runner('gh', [
    'issue', 'create',
    '--repo', repo,        // e.g. 'HexingBot/hivemind'
    '--title', title,
    '--body', body,        // pass body as a single arg; gh handles newlines fine
  ]);

  if (result.status !== 0) {
    throw new Error(`gh issue create failed (exit ${result.status}): ${result.stderr}`);
  }

  // gh prints the new issue URL as the last non-empty stdout line, e.g.
  //   https://github.com/HexingBot/hivemind/issues/42
  const url = result.stdout.trim().split('\n').filter(Boolean).at(-1);
  if (!url || !url.startsWith('https://')) {
    throw new Error(`gh issue create returned unexpected output: ${result.stdout}`);
  }
  return { url };
}
```

**Using `--body-file -` (stdin) instead of `--body`:** preferred when the body
may contain characters that shell-escape is fragile for. Pipe via `input` option
of `spawnSync`:

```js
const result = spawnSync('gh', ['issue', 'create', '--repo', repo,
  '--title', title, '--body-file', '-'],
  { input: body, encoding: 'utf8', timeout: 30_000 });
```

Both forms work; the `--body` flag is simpler for short bodies with an injectable
runner. Use `--body-file -` when body exceeds ~2 KB or contains backticks/quotes.

### 3. Secret-scrub the body before submission

All content that goes to GitHub MUST pass through `scrubSecrets` first.

```js
const REDACT = '[REDACTED]';

/** Ordered list of {pattern, label} substitutions applied left-to-right. */
const SECRET_PATTERNS = [
  // GitHub tokens (classic PAT and fine-grained PAT)
  { re: /ghp_[A-Za-z0-9]{36}/g,          label: 'ghp_token' },
  { re: /gho_[A-Za-z0-9]{36}/g,          label: 'gho_token' },
  { re: /ghs_[A-Za-z0-9]{36}/g,          label: 'ghs_token' },
  { re: /ghu_[A-Za-z0-9]{36}/g,          label: 'ghu_token' },
  { re: /ghr_[A-Za-z0-9]{36}/g,          label: 'ghr_token' },
  { re: /github_pat_[A-Za-z0-9_]{82}/g,  label: 'github_pat' },
  // Anthropic API keys
  { re: /sk-ant-[A-Za-z0-9\-_]{40,}/g,   label: 'sk_ant_key' },
  // Generic sk- keys (OpenAI etc.)
  { re: /sk-[A-Za-z0-9]{20,}/g,          label: 'sk_key' },
  // AWS access key IDs
  { re: /(?:AKIA|ASIA)[A-Z0-9]{16}/g,    label: 'aws_akid' },
  // AWS secret access keys (heuristic: 40 base64 chars after = or space)
  { re: /(?<=AWS_SECRET_ACCESS_KEY[=:\s]["']?)[A-Za-z0-9+/]{40}/g, label: 'aws_secret' },
  // URI-userinfo credentials: scheme://user:pass@host (e.g. a connection
  // string like bolt://neo4j:hunter2@db:7687). Only the credential portion
  // is replaced — the captured scheme keeps scheme+host readable.
  { re: /(\w+:\/\/)[^/\s:@]+:[^/\s@]+@/gi,
    label: 'uri_userinfo',
    replace: (_m, scheme) => `${scheme}[REDACTED:uri_userinfo]@` },
  // Bearer / Authorization header values
  { re: /(?<=(?:Authorization|Bearer)[:\s]+)[A-Za-z0-9\-._~+/]+=*/gi, label: 'bearer_token' },
  // Env-var assignment patterns: FOO_TOKEN=value, BAR_SECRET="value", BAZ_KEY=value,
  // FOO_AUTH=value, and bare PASSWORD=value (e.g. NEO4J_AUTH=neo4j/hunter2)
  { re: /\b(?:\w+_TOKEN|\w+_SECRET|\w+_KEY|\w+_PASSWORD|\w+_CREDENTIAL|\w*_AUTH|PASSWORD)\s*=\s*["']?[^\s"']{8,}["']?/gi,
    label: 'env_secret' },
];

/**
 * Replace known secret patterns with [REDACTED:<label>].
 * Returns the scrubbed string. Never mutates the input.
 *
 * @param {string} text
 * @returns {string}
 */
export function scrubSecrets(text) {
  let out = text;
  for (const { re, label, replace } of SECRET_PATTERNS) {
    // A pattern may supply its own `replace` function to keep a captured
    // group (e.g. the URI scheme) legible instead of replacing the whole match.
    out = out.replace(re, replace ?? `[REDACTED:${label}]`);
  }
  return out;
}
```

**Known false-negative cases** the Developer must document in tests:
- Long hex strings that are NOT tokens (e.g. git commit SHAs): not matched by the
  prefix-anchored patterns above, so they pass through correctly.
- Tokens stored in `.claude/settings.json` keys: the settings file itself is NEVER
  read by the collector — the context block only reads known safe fields
  (plugin version, OS, project name, active session/task key). Do not add a settings
  reader; absence is the defense.
- Custom prefixes the user's project uses (e.g. `myapp_secret_XYZ`): the `env_secret`
  regex only covers `_TOKEN`, `_SECRET`, `_KEY`, `_PASSWORD`, `_CREDENTIAL`, `_AUTH`
  suffixes and bare `PASSWORD=`. Document this limitation in the command's output
  so users know to review before submitting.
- Multiline values split across lines: most patterns are single-line. For env
  assignments that wrap, only the first line is redacted.

### 4. Collect safe context (no secrets)

```js
import { platform, release } from 'node:os';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Collect a safe, secret-free context block for the bug report.
 *
 * @param {{ pluginRoot: string, projectDir: string }} opts
 * @returns {string}  a markdown fenced block
 */
export function collectContext({ pluginRoot, projectDir }) {
  // Plugin version from plugin.json (safe metadata, no secrets)
  let pluginVersion = 'unknown';
  try {
    const manifest = JSON.parse(
      readFileSync(join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8'));
    pluginVersion = manifest.version ?? 'unknown';
  } catch { /* ignore */ }

  // Project name from PROJECT.md frontmatter (first --- block, name field)
  let projectName = 'unknown';
  const projectMdPath = join(projectDir, 'PROJECT.md');
  if (existsSync(projectMdPath)) {
    const raw = readFileSync(projectMdPath, 'utf8');
    const m = raw.match(/^---[\s\S]*?project_name:\s*(.+?)[\s\S]*?---/m);
    if (m) projectName = m[1].trim();
  }

  // Active session / task from state/session.json (key only, no body)
  let activeSession = 'none';
  let activeTask = 'none';
  const sessionPtrPath = join(projectDir, 'state', 'session.json');
  if (existsSync(sessionPtrPath)) {
    try {
      const ptr = JSON.parse(readFileSync(sessionPtrPath, 'utf8'));
      if (ptr.active_session_id) {
        activeSession = ptr.active_session_id;
        const bundlePath = join(projectDir, 'state', 'sessions',
          ptr.active_session_id, 'session.json');
        if (existsSync(bundlePath)) {
          const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));
          activeTask = bundle.active_task ?? 'none';
        }
      }
    } catch { /* ignore */ }
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
```

### 5. Build the full issue body

```js
/**
 * Compose and scrub the complete issue body.
 *
 * @param {{ title: string, repro: string, expected: string, actual: string,
 *            severity: string, evidence?: string, context: string }} opts
 * @returns {string}
 */
export function buildIssueBody({ title, repro, expected, actual,
                                  severity, evidence, context }) {
  const parts = [
    `## What happened\n${actual}`,
    `## What was expected\n${expected}`,
    `## Steps to reproduce\n${repro}`,
    `## Severity\n${severity}`,
  ];
  if (evidence) parts.push(`## Evidence\n\`\`\`\n${evidence}\n\`\`\``);
  parts.push(`## Auto-collected context\n${context}`);

  const raw = parts.join('\n\n');
  return scrubSecrets(raw);  // ALWAYS scrub before returning
}
```

### 6. Top-level orchestrator: fileFrameworkBug

```js
/**
 * The single entry point the command markdown invokes.
 * Injectable runner and fallbackWriter make it fully testable without disk/network.
 *
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} opts.body          pre-built, pre-scrubbed issue body
 * @param {string} opts.pluginRoot    CLAUDE_PLUGIN_ROOT
 * @param {string} opts.projectDir    CLAUDE_PROJECT_DIR
 * @param {string} [opts.repo]        default DEFAULT_REPO ('HexingBot/hivemind')
 * @param {function} [opts.runner]    spawnSync-compatible injectable
 * @param {function} [opts.fallbackWriter]  (path, content) => void, default fs.writeFileSync
 * @returns {{ filed: 'github'|'local', url?: string, path?: string, reason?: string }}
 */
export async function fileFrameworkBug({
  title, body, pluginRoot, projectDir,
  repo = DEFAULT_REPO,
  runner,
  fallbackWriter,
}) {
  // `reason` names the ACTUAL cause of a fallback — gh can be present and
  // authenticated and still fail `gh issue create` (wrong repo, disabled
  // issues, etc.), so "not available" / "not authenticated" must not be used
  // as a blanket explanation for every fallback.
  let reason;
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

  // Fallback: write to a local file in the project's .claude/ directory
  const fallbackDir = join(projectDir, '.claude', 'framework-bug-reports');
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = join(fallbackDir, `bug-report-${ts}.md`);
  const content = `# ${title}\n\n${body}\n`;

  const writer = fallbackWriter ?? ((p, c) => {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, c, 'utf8');
  });
  writer(filePath, content);

  return { filed: 'local', path: filePath, reason };
}
```

## Best Practices

- **Do** inject the runner in every function that calls `gh`. It makes unit tests
  instant and avoids real network calls.
- **Do** scrub secrets (`scrubSecrets`) before building the body, not after.
  Once the body is assembled it should already be clean.
- **Do** check BOTH `gh --version` exit code AND `gh auth status` stderr for the
  "not logged into any GitHub hosts" string (exit-code-always-0 bug).
- **Do** use `--body-file -` (stdin) if the body may contain shell-unfriendly
  characters (backticks, quotes, `$`).
- **Do not** read `.claude/settings.json` in the context collector — absence is the
  defense against leaking project secrets via settings values.
- **Do not** include the full session bundle body in the context block — only the
  session ID and active task KEY (not its JSON).
- **Do not** attempt to assign, label, or add the issue to a project in the initial
  creation — those operations require extra OAuth scopes that downstream users may
  not have.

## Viability note: non-collaborator issue creation (CRITICAL)

Any authenticated GitHub user with read access to a public repository CAN create
issues on it via `gh issue create`. The GitHub REST API endpoint POST
`/repos/{owner}/{repo}/issues` requires only a valid OAuth token with `repo` or
`public_repo` scope — no collaborator status. This is confirmed by the official
docs: "Any user with pull access to a repository can create an issue."

**Therefore the feature IS viable for arbitrary downstream users of the plugin,
not only the maintainer.** The only cases where creation fails are:

1. The repository owner has enabled interaction limits (collaborators-only or
   existing-users-only modes) — very rare on open-source repos.
2. The user's gh token lacks the `public_repo` scope — possible for fine-grained
   PATs with restricted scopes.
3. Issues are disabled on the repository.

The fallback to a local file handles all three cases gracefully.

## Common Pitfalls

- **gh auth status always exits 0 (gh <= 2.42.1):** check stderr too (see Workflow 1).
- **`gh issue create` prompts interactively when title or body is missing:** always
  pass both `--title` and `--body` (or `--body-file`); omitting either drops into
  an editor session that hangs non-interactive callers.
- **`--body` with newlines on Windows PowerShell:** prefer `--body-file -` with stdin
  piping if the body contains `\n`. The `--body` flag works reliably on bash; on
  PowerShell, newlines may be mangled by the shell before gh sees them.
- **Issue URL parsing:** gh prints the URL as the LAST non-blank stdout line. Earlier
  lines may include deprecation notices or config warnings. Always split on `\n` and
  take the last non-empty token.
- **Rate limits:** GitHub allows 5000 requests per hour per authenticated user. Filing
  one bug report consumes 1 request. No throttling logic needed.
- **`env_secret` regex false positives:** env-var names like `DEBUG_LEVEL=verbose`
  will not match (no `_TOKEN`/`_SECRET`/etc. suffix); but `SOME_KEY=foo` WILL match
  and be redacted. This is intentional — false positives are safe, false negatives
  are not.

## Verification

After implementing `src/framework-bug-report.js`:

1. Fast unit tests (pure logic, no disk): `npm test` — covers `scrubSecrets`,
   `collectContext` with mock fs, `buildIssueBody`, `detectGh` with injected runner,
   `ghIssueCreate` with injected runner (success + failure paths),
   `fileFrameworkBug` with gh available/auth OK, gh unavailable, gh not authenticated.
2. E2E / integration (optional): spawn a real `gh --version` and `gh auth status`
   in CI where GH_TOKEN is set. Skip if GH_TOKEN is absent.
3. Dist parity: after adding the new entrypoint to `build-plugin.mjs`, run
   `npm run build:plugin` and verify `dist/report-framework-bug.cjs` exists, then
   run `npm run test:all` so `dist-parity.spec.js` validates the bundle.

## References

- [`references/gh-issue-create-flags.md`](references/gh-issue-create-flags.md) — full flag reference for `gh issue create`.
- [`references/secret-patterns.md`](references/secret-patterns.md) — extended regex catalog for more token types.

## Provenance

- **Authored by:** Researcher subagent on behalf of TASK-010.
- **Primary sources:**
  - https://cli.github.com/manual/gh_issue_create
  - https://docs.github.com/en/rest/issues/issues#create-an-issue
  - https://cli.github.com/manual/gh_auth_status
  - https://github.com/cli/cli/issues/8845 (exit-code bug)
- **Last verified:** 2026-06-23.
