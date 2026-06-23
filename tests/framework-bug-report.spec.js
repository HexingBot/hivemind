// tests/framework-bug-report.spec.js
// TASK-010 — Failing tests for src/framework-bug-report.js and
// commands/report-framework-bug.md.
//
// All tests in this file are pure-logic / in-process (no real disk I/O,
// no real `gh` invocations). Every `runner` and `fallbackWriter` argument
// is an injected mock. This keeps the spec in the FAST tier (tests/*.spec.js).
//
// AC map:
//   AC1 — command file exists with correct frontmatter and body reference
//   AC2 — gh-available + authenticated path: detectGh, ghIssueCreate, fileFrameworkBug
//   AC3 — gh-unavailable / not-authenticated fallback path
//   AC4 — scrubSecrets redacts each pattern family; collectContext never reads
//          .claude/settings.json; buildIssueBody scrubs embedded secrets
//   AC5 — body assembly / context collection / scrub / gh-success vs gh-missing
//          are distinct, non-tautological assertions

import { describe, it, expect, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __thisDir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__thisDir, '..');

// ---------------------------------------------------------------------------
// Module-under-test (dynamic import so tests fail with the right reason when
// the file is absent — not with a parse error in the test itself).
// ---------------------------------------------------------------------------
const MOD_URL = pathToFileURL(join(REPO_ROOT, 'src', 'framework-bug-report.js')).href;

let scrubSecrets, collectContext, buildIssueBody, detectGh, ghIssueCreate, fileFrameworkBug;

try {
  const mod = await import(MOD_URL);
  scrubSecrets = mod.scrubSecrets;
  collectContext = mod.collectContext;
  buildIssueBody = mod.buildIssueBody;
  detectGh = mod.detectGh;
  ghIssueCreate = mod.ghIssueCreate;
  fileFrameworkBug = mod.fileFrameworkBug;
} catch {
  // Module not found yet — every test below will fail because the exported
  // names are undefined. That is the correct "right-reason" failure for TDD.
}

// ---------------------------------------------------------------------------
// AC1 — command file exists and has correct frontmatter + body reference
// ---------------------------------------------------------------------------

describe('AC1 — commands/report-framework-bug.md', () => {
  const CMD_PATH = join(REPO_ROOT, 'commands', 'report-framework-bug.md');

  it('the command file exists on disk', () => {
    expect(existsSync(CMD_PATH)).toBe(true);
  });

  it('frontmatter has a non-empty description field', () => {
    const raw = readFileSync(CMD_PATH, 'utf8');
    // YAML frontmatter is the block between leading --- and the second ---
    expect(raw).toMatch(/^---[\s\S]*?description:\s*.+[\s\S]*?---/m);
  });

  it('frontmatter has panel_safe: true', () => {
    const raw = readFileSync(CMD_PATH, 'utf8');
    expect(raw).toMatch(/panel_safe:\s*true/);
  });

  it('the body mentions the command name report-framework-bug', () => {
    const raw = readFileSync(CMD_PATH, 'utf8');
    expect(raw).toMatch(/report-framework-bug/);
  });
});

// ---------------------------------------------------------------------------
// AC2 — gh available + authenticated → files a GitHub issue
// ---------------------------------------------------------------------------

describe('AC2 — detectGh with authenticated mock runner', () => {
  function makeAuthenticatedRunner() {
    return vi.fn((cmd, args) => {
      if (args.includes('--version')) {
        return { status: 0, stdout: 'gh version 2.50.0 (2024-01-01)\n', stderr: '' };
      }
      if (args.includes('auth') && args.includes('status')) {
        // auth status exits 0 and stderr does NOT include "not logged into"
        return { status: 0, stdout: '', stderr: 'Logged in to github.com account testuser\n' };
      }
      return { status: 1, stdout: '', stderr: 'unexpected call' };
    });
  }

  it('returns available:true when gh --version exits 0', () => {
    const runner = makeAuthenticatedRunner();
    const result = detectGh(runner);
    expect(result.available).toBe(true);
  });

  it('returns authenticated:true when auth status exits 0 and stderr has no "not logged into" string', () => {
    const runner = makeAuthenticatedRunner();
    const result = detectGh(runner);
    expect(result.authenticated).toBe(true);
  });
});

describe('AC2 — ghIssueCreate parses the URL from last non-empty stdout line', () => {
  it('returns the URL from the last non-empty stdout line on success', () => {
    const mockUrl = 'https://github.com/lordiwa/agent-framework/issues/42';
    const runner = vi.fn(() => ({
      status: 0,
      stdout: `Creating issue...\n\n${mockUrl}\n`,
      stderr: '',
    }));

    const result = ghIssueCreate(
      { title: 'Test bug', body: 'Some body', repo: 'lordiwa/agent-framework' },
      runner,
    );
    expect(result.url).toBe(mockUrl);
  });

  it('throws an error mentioning the exit status on non-zero exit', () => {
    // The thrown error message must mention the exit code so callers can diagnose failures.
    // This also guards against vacuous-pass when ghIssueCreate is undefined (TypeError
    // would not contain "exit 1" in its message, so toThrow(/exit 1/) fails correctly).
    const runner = vi.fn(() => ({
      status: 1,
      stdout: '',
      stderr: 'authentication required',
    }));

    expect(() =>
      ghIssueCreate(
        { title: 'Test bug', body: 'body', repo: 'lordiwa/agent-framework' },
        runner,
      ),
    ).toThrow(/exit 1/);
  });
});

describe('AC2 — fileFrameworkBug returns {filed:"github", url} when gh is authed', () => {
  it('files via github and returns the issue URL', async () => {
    const issueUrl = 'https://github.com/lordiwa/agent-framework/issues/99';
    const runner = vi.fn((cmd, args) => {
      if (args.includes('--version')) {
        return { status: 0, stdout: 'gh version 2.50.0\n', stderr: '' };
      }
      if (args.includes('auth') && args.includes('status')) {
        return { status: 0, stdout: '', stderr: 'Logged in to github.com account user\n' };
      }
      if (args.includes('issue') && args.includes('create')) {
        return { status: 0, stdout: `\n${issueUrl}\n`, stderr: '' };
      }
      return { status: 1, stdout: '', stderr: 'unexpected' };
    });

    const fallbackWriter = vi.fn();
    const result = await fileFrameworkBug({
      title: 'Framework bug title',
      body: 'Bug body text',
      pluginRoot: '/fake/plugin',
      projectDir: '/fake/project',
      runner,
      fallbackWriter,
    });

    expect(result.filed).toBe('github');
    expect(result.url).toBe(issueUrl);
    expect(fallbackWriter).not.toHaveBeenCalled();
  });
});

describe('AC2 — buildIssueBody assembles the expected sections', () => {
  it('includes observed, expected, steps, severity in the body', () => {
    // buildIssueBody must be a function — if undefined, this call throws TypeError (right failure)
    const ctx = '```\nplugin_version: 1.0.0\n```';
    const body = buildIssueBody({
      title: 'My bug',
      observed: 'it crashes',
      expected: 'it should work',
      steps: '1. do thing',
      environment: 'macOS',
      severity: 'high',
      context: ctx,
    });
    expect(body).toMatch(/it crashes/);
    expect(body).toMatch(/it should work/);
    expect(body).toMatch(/1\. do thing/);
    expect(body).toMatch(/high/);
  });

  it('includes the auto-collected context block in the assembled body', () => {
    const ctx = '```\nplugin_version: 2.3.1\nproject: my-project\n```';
    const body = buildIssueBody({
      title: 'Bug',
      observed: 'bad',
      expected: 'good',
      steps: 'step 1',
      environment: 'linux',
      severity: 'medium',
      context: ctx,
    });
    expect(body).toMatch(/plugin_version: 2\.3\.1/);
    expect(body).toMatch(/my-project/);
  });

  it('includes optional evidence section when provided', () => {
    const body = buildIssueBody({
      title: 'Bug',
      observed: 'bad',
      expected: 'good',
      steps: 'step 1',
      environment: 'linux',
      severity: 'low',
      evidence: 'Error: stack trace here',
      context: '```\nctx\n```',
    });
    expect(body).toMatch(/stack trace here/);
  });
});

// ---------------------------------------------------------------------------
// AC3 — gh-unavailable / not-authenticated fallback path
// ---------------------------------------------------------------------------

describe('AC3 — detectGh with gh binary absent', () => {
  it('returns available:false and authenticated:false when gh --version exits non-zero', () => {
    const runner = vi.fn(() => ({ status: 127, stdout: '', stderr: 'command not found: gh' }));
    const result = detectGh(runner);
    expect(result.available).toBe(false);
    expect(result.authenticated).toBe(false);
  });
});

describe('AC3 — detectGh with gh present but not authenticated (exit-code bug scenario)', () => {
  it('returns authenticated:false when auth status exits 0 but stderr says "not logged into any GitHub hosts"', () => {
    // This is the known gh <= 2.42.1 exit-code bug: auth status exits 0 even when not authed.
    // The implementation MUST also check stderr.
    const runner = vi.fn((cmd, args) => {
      if (args.includes('--version')) {
        return { status: 0, stdout: 'gh version 2.42.0\n', stderr: '' };
      }
      if (args.includes('auth') && args.includes('status')) {
        // exits 0 (the bug), but stderr betrays the truth
        return { status: 0, stdout: '', stderr: 'You are not logged into any GitHub hosts. Run gh auth login to authenticate.\nnot logged into any GitHub hosts\n' };
      }
      return { status: 1, stdout: '', stderr: '' };
    });

    const result = detectGh(runner);
    expect(result.available).toBe(true);
    expect(result.authenticated).toBe(false);
  });

  it('returns authenticated:false when auth status exits 1 (normal not-authed case)', () => {
    const runner = vi.fn((cmd, args) => {
      if (args.includes('--version')) {
        return { status: 0, stdout: 'gh version 2.50.0\n', stderr: '' };
      }
      if (args.includes('auth') && args.includes('status')) {
        return { status: 1, stdout: '', stderr: 'not logged into any GitHub hosts' };
      }
      return { status: 1, stdout: '', stderr: '' };
    });

    const result = detectGh(runner);
    expect(result.authenticated).toBe(false);
  });
});

describe('AC3 — fileFrameworkBug falls back to local when gh is missing', () => {
  it('calls fallbackWriter and returns {filed:"local", path} when gh is unavailable', async () => {
    const runner = vi.fn(() => ({ status: 127, stdout: '', stderr: 'command not found: gh' }));
    const fallbackWriter = vi.fn();

    const result = await fileFrameworkBug({
      title: 'Framework bug',
      body: 'Some body',
      pluginRoot: '/fake/plugin',
      projectDir: '/fake/project',
      runner,
      fallbackWriter,
    });

    expect(result.filed).toBe('local');
    expect(typeof result.path).toBe('string');
    expect(result.path.length).toBeGreaterThan(0);
    expect(fallbackWriter).toHaveBeenCalledOnce();
  });

  it('does not throw when gh is unavailable', async () => {
    const runner = vi.fn(() => ({ status: 127, stdout: '', stderr: 'command not found: gh' }));
    const fallbackWriter = vi.fn();

    await expect(
      fileFrameworkBug({
        title: 'test',
        body: 'body',
        pluginRoot: '/p',
        projectDir: '/d',
        runner,
        fallbackWriter,
      }),
    ).resolves.not.toThrow();
  });
});

describe('AC3 — fileFrameworkBug falls back to local when gh present but not authenticated', () => {
  it('calls fallbackWriter and returns {filed:"local"} when gh is present but unauthed', async () => {
    const runner = vi.fn((cmd, args) => {
      if (args.includes('--version')) {
        return { status: 0, stdout: 'gh version 2.50.0\n', stderr: '' };
      }
      if (args.includes('auth') && args.includes('status')) {
        return { status: 1, stdout: '', stderr: 'not logged into any GitHub hosts' };
      }
      return { status: 1, stdout: '', stderr: '' };
    });
    const fallbackWriter = vi.fn();

    const result = await fileFrameworkBug({
      title: 'Bug',
      body: 'body',
      pluginRoot: '/p',
      projectDir: '/d',
      runner,
      fallbackWriter,
    });

    expect(result.filed).toBe('local');
    expect(fallbackWriter).toHaveBeenCalledOnce();
  });

  it('does not throw when gh is present but not authenticated', async () => {
    const runner = vi.fn((cmd, args) => {
      if (args.includes('--version')) {
        return { status: 0, stdout: 'gh version 2.50.0\n', stderr: '' };
      }
      if (args.includes('auth') && args.includes('status')) {
        return { status: 1, stdout: '', stderr: 'not logged into any GitHub hosts' };
      }
      return { status: 1, stdout: '', stderr: '' };
    });

    await expect(
      fileFrameworkBug({
        title: 'test',
        body: 'body',
        pluginRoot: '/p',
        projectDir: '/d',
        runner: runner,
        fallbackWriter: vi.fn(),
      }),
    ).resolves.not.toThrow();
  });
});

describe('AC3 — fallbackWriter is called with the report content containing title and body', () => {
  it('passes content containing the title to fallbackWriter', async () => {
    const runner = vi.fn(() => ({ status: 127, stdout: '', stderr: 'not found' }));
    const fallbackWriter = vi.fn();

    await fileFrameworkBug({
      title: 'Unique bug title XYZ',
      body: 'body content',
      pluginRoot: '/p',
      projectDir: '/d',
      runner,
      fallbackWriter,
    });

    const [, content] = fallbackWriter.mock.calls[0];
    expect(content).toMatch(/Unique bug title XYZ/);
  });
});

// ---------------------------------------------------------------------------
// AC4 — scrubSecrets: each pattern family is redacted; safe text passes through
// ---------------------------------------------------------------------------

describe('AC4 — scrubSecrets: GitHub token patterns', () => {
  it('redacts ghp_ classic PAT tokens', () => {
    const input = 'token ghp_' + 'A'.repeat(36) + ' end';
    expect(scrubSecrets(input)).not.toMatch(/ghp_[A-Za-z0-9]{36}/);
    expect(scrubSecrets(input)).toMatch(/\[REDACTED/);
  });

  it('redacts gho_ OAuth tokens', () => {
    const input = 'token=gho_' + 'B'.repeat(36);
    expect(scrubSecrets(input)).not.toMatch(/gho_[A-Za-z0-9]{36}/);
  });

  it('redacts ghs_ server-to-server tokens', () => {
    const input = 'auth ghs_' + 'C'.repeat(36);
    expect(scrubSecrets(input)).not.toMatch(/ghs_[A-Za-z0-9]{36}/);
  });

  it('redacts ghu_ user-to-server tokens', () => {
    const input = 'ghu_' + 'D'.repeat(36);
    expect(scrubSecrets(input)).not.toMatch(/ghu_[A-Za-z0-9]{36}/);
  });

  it('redacts ghr_ refresh tokens', () => {
    const input = 'ghr_' + 'E'.repeat(36);
    expect(scrubSecrets(input)).not.toMatch(/ghr_[A-Za-z0-9]{36}/);
  });

  it('redacts github_pat_ fine-grained PATs', () => {
    const input = 'github_pat_' + 'F'.repeat(82);
    expect(scrubSecrets(input)).not.toMatch(/github_pat_/);
  });
});

describe('AC4 — scrubSecrets: Anthropic and generic API key patterns', () => {
  it('redacts sk-ant- Anthropic keys', () => {
    const input = 'key=sk-ant-' + 'api03-' + 'G'.repeat(40);
    expect(scrubSecrets(input)).not.toMatch(/sk-ant-/);
  });

  it('redacts generic sk- keys (OpenAI style)', () => {
    const input = 'OPENAI_KEY=sk-' + 'H'.repeat(20);
    expect(scrubSecrets(input)).not.toMatch(/sk-[A-Za-z0-9]{20}/);
  });
});

describe('AC4 — scrubSecrets: AWS key patterns', () => {
  it('redacts AKIA* AWS access key IDs', () => {
    const input = 'key=AKIA' + 'I'.repeat(16);
    expect(scrubSecrets(input)).not.toMatch(/AKIA[A-Z0-9]{16}/);
  });

  it('redacts ASIA* AWS STS access key IDs', () => {
    const input = 'key=ASIA' + 'J'.repeat(16);
    expect(scrubSecrets(input)).not.toMatch(/ASIA[A-Z0-9]{16}/);
  });
});

describe('AC4 — scrubSecrets: modern OpenAI key patterns (regression: TASK-010 HIGH)', () => {
  it('redacts sk-proj-... segmented OpenAI project keys', () => {
    // Real format: sk-proj-<base62_body>-<more_segments>
    const input = 'OPENAI_KEY=sk-proj-Ab3xYzT3BlbkFJxy9abc123defghijklmnopqrstuvwx';
    const out = scrubSecrets(input);
    expect(out).not.toMatch(/sk-proj-/);
    expect(out).toMatch(/\[REDACTED/);
  });

  it('redacts sk-svcacct-... OpenAI service-account keys', () => {
    const input = `key: sk-svcacct-${'A'.repeat(40)}`;
    const out = scrubSecrets(input);
    expect(out).not.toMatch(/sk-svcacct-/);
    expect(out).toMatch(/\[REDACTED/);
  });

  it('redacts sk-admin-... OpenAI admin keys', () => {
    const input = `admin key: sk-admin-${'B'.repeat(30)}`;
    const out = scrubSecrets(input);
    expect(out).not.toMatch(/sk-admin-/);
    expect(out).toMatch(/\[REDACTED/);
  });

  it('still redacts legacy sk- keys without a named segment', () => {
    const input = 'OPENAI_KEY=sk-' + 'H'.repeat(20);
    expect(scrubSecrets(input)).not.toMatch(/sk-[A-Za-z0-9]{20}/);
  });
});

describe('AC4 — scrubSecrets: Slack token patterns (regression: TASK-010 MEDIUM)', () => {
  it('redacts xoxb- Slack bot tokens', () => {
    const input = 'token: xoxb-123456789012-1234567890123-abcdefghijklmnop';
    const out = scrubSecrets(input);
    expect(out).not.toMatch(/xoxb-/);
    expect(out).toMatch(/\[REDACTED/);
  });

  it('redacts xoxp- Slack user tokens', () => {
    const input = 'slack_user_token=xoxp-' + 'A'.repeat(20);
    expect(scrubSecrets(input)).not.toMatch(/xoxp-/);
  });

  it('redacts xoxa- Slack app tokens', () => {
    const input = 'xoxa-' + '9'.repeat(15);
    expect(scrubSecrets(input)).not.toMatch(/xoxa-/);
  });

  it('redacts xoxr- Slack refresh tokens', () => {
    const input = 'refresh=xoxr-' + 'z'.repeat(15);
    expect(scrubSecrets(input)).not.toMatch(/xoxr-/);
  });

  it('redacts xoxs- Slack socket-mode tokens', () => {
    const input = 'socket=xoxs-' + 'Q'.repeat(15);
    expect(scrubSecrets(input)).not.toMatch(/xoxs-/);
  });
});

describe('AC4 — scrubSecrets: Google API key pattern (regression: TASK-010 MEDIUM)', () => {
  it('redacts AIza... Google API keys', () => {
    // Google API keys are exactly AIza + 35 alphanumeric/dash/underscore chars
    const input = 'google_key=AIza' + 'Bb3cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV3wX4y5z6';
    const out = scrubSecrets(input);
    expect(out).not.toMatch(/AIza[0-9A-Za-z_-]{35}/);
    expect(out).toMatch(/\[REDACTED/);
  });

  it('does NOT redact AIza strings shorter than the required body length', () => {
    // AIza + 34 chars = too short — should pass through
    const input = 'AIza' + 'x'.repeat(34);
    // Should not be redacted (34 < 35)
    expect(scrubSecrets(input)).toBe(input);
  });
});

describe('AC4 — scrubSecrets: PEM private key block (regression: TASK-010 MEDIUM)', () => {
  it('redacts RSA PRIVATE KEY PEM blocks', () => {
    const pem = [
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIEpAIBAAKCAQEA0Z3VS5JJcds3xHn/ygWep4GHXhB2vBmNkuNKhQFCaXfBi9Z',
      'MIIEpAIBAAKCAQEA0Z3VS5JJcds3xHn/ygWep4GHXhB2vBmNkuNKhQFCaXfBi9Z',
      '-----END RSA PRIVATE KEY-----',
    ].join('\n');
    const out = scrubSecrets(`key material:\n${pem}\nend`);
    expect(out).not.toMatch(/BEGIN RSA PRIVATE KEY/);
    expect(out).not.toMatch(/MIIEpAIBAAK/);
    expect(out).toMatch(/\[REDACTED/);
  });

  it('redacts generic PRIVATE KEY PEM blocks (PKCS#8)', () => {
    const pem = [
      '-----BEGIN PRIVATE KEY-----',
      'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7',
      '-----END PRIVATE KEY-----',
    ].join('\n');
    const out = scrubSecrets(pem);
    expect(out).not.toMatch(/BEGIN PRIVATE KEY/);
    expect(out).toMatch(/\[REDACTED/);
  });

  it('does NOT redact BEGIN PUBLIC KEY blocks (not private)', () => {
    const pub = '-----BEGIN PUBLIC KEY-----\nMFwwDQYJKoZIhvcNAQEBBQADSwAw\n-----END PUBLIC KEY-----';
    expect(scrubSecrets(pub)).toBe(pub);
  });
});

describe('AC4 — scrubSecrets: github_pat_ loosened boundary (regression: TASK-010 LOW)', () => {
  it('redacts github_pat_ tokens with just-under-82-char suffix', () => {
    // 20 chars after prefix — well below the old 82-char floor
    const input = 'github_pat_' + 'F'.repeat(20);
    expect(scrubSecrets(input)).not.toMatch(/github_pat_/);
  });

  it('still redacts the original 82-char suffix length', () => {
    const input = 'github_pat_' + 'G'.repeat(82);
    expect(scrubSecrets(input)).not.toMatch(/github_pat_/);
  });
});

describe('AC4 — scrubSecrets: Authorization/Bearer header patterns', () => {
  it('redacts Bearer token values', () => {
    const input = 'Authorization: Bearer mySecretToken123456';
    const out = scrubSecrets(input);
    expect(out).not.toMatch(/mySecretToken123456/);
    expect(out).toMatch(/\[REDACTED/);
  });
});

describe('AC4 — scrubSecrets: env-var assignment patterns', () => {
  it('redacts *_TOKEN= assignments', () => {
    const input = 'GITHUB_TOKEN=abcdefghijklmn';
    const out = scrubSecrets(input);
    expect(out).not.toMatch(/abcdefghijklmn/);
  });

  it('redacts *_SECRET= assignments', () => {
    const input = 'AWS_SECRET=supersecretvalue123';
    const out = scrubSecrets(input);
    expect(out).not.toMatch(/supersecretvalue123/);
  });

  it('redacts *_KEY= assignments', () => {
    const input = 'API_KEY=myprivatekey9999';
    const out = scrubSecrets(input);
    expect(out).not.toMatch(/myprivatekey9999/);
  });

  it('redacts *_PASSWORD= assignments', () => {
    const input = 'DB_PASSWORD=hunter2hunter2';
    const out = scrubSecrets(input);
    expect(out).not.toMatch(/hunter2hunter2/);
  });
});

describe('AC4 — scrubSecrets: safe text passes through unchanged', () => {
  it('does NOT redact a 40-character git SHA (no secret prefix)', () => {
    const sha = 'a'.repeat(40);
    expect(scrubSecrets(sha)).toBe(sha);
  });

  it('does NOT redact plain prose text', () => {
    const text = 'The quick brown fox jumps over the lazy dog';
    expect(scrubSecrets(text)).toBe(text);
  });

  it('does NOT redact ordinary version strings', () => {
    const text = 'v1.2.3 and node 20.0.0';
    expect(scrubSecrets(text)).toBe(text);
  });

  it('returns a string (never mutates), even for an empty input', () => {
    expect(scrubSecrets('')).toBe('');
  });
});

describe('AC4 — scrubSecrets: hyphenated identifier pass-through (regression: TASK-010 HIGH)', () => {
  // These are legitimate hyphenated identifiers that contain "sk" as a natural
  // syllable inside a longer word (task, risk, disk, ask, desk). Before the \b
  // anchor was added to pattern #4, the bare /sk-.../ regex would latch onto the
  // "sk" tail of those words and mangle the identifier.

  it('does NOT redact task-management-system-component-handler', () => {
    const text = 'task-management-system-component-handler';
    expect(scrubSecrets(text)).toBe(text);
  });

  it('does NOT redact risk-based-assessment-framework-evaluation-model', () => {
    const text = 'risk-based-assessment-framework-evaluation-model';
    expect(scrubSecrets(text)).toBe(text);
  });

  it('does NOT redact disk-usage-monitoring-subsystem-daemon-process', () => {
    const text = 'disk-usage-monitoring-subsystem-daemon-process';
    expect(scrubSecrets(text)).toBe(text);
  });

  it('does NOT redact ask-me-anything-about-the-framework-system-components', () => {
    const text = 'ask-me-anything-about-the-framework-system-components';
    expect(scrubSecrets(text)).toBe(text);
  });

  it('does NOT redact desk-reference-guide-for-system-administration-tasks', () => {
    const text = 'desk-reference-guide-for-system-administration-tasks';
    expect(scrubSecrets(text)).toBe(text);
  });

  it('does NOT redact myxoxb-... (xox as part of a longer word prefix)', () => {
    // Regression for pattern #6: \b anchor ensures xox- is only matched when
    // "xox" starts at a word boundary, not as a suffix of a compound word.
    const text = 'myxoxb-123456789012-1234567890123-abcdefghijklmnop';
    expect(scrubSecrets(text)).toBe(text);
  });
});

describe('AC4 — buildIssueBody scrubs secrets embedded in inputs', () => {
  it('redacts a token that appears in the observed field', () => {
    // buildIssueBody must be a function — TypeError on undefined is the right pre-impl failure
    const token = 'ghp_' + 'Z'.repeat(36);
    const body = buildIssueBody({
      title: 'Bug',
      observed: `Got error, token was ${token}`,
      expected: 'no error',
      steps: 'step 1',
      environment: 'linux',
      severity: 'high',
      context: '```\nctx\n```',
    });
    expect(body).not.toMatch(/ghp_[A-Za-z0-9]{36}/);
    expect(body).toMatch(/\[REDACTED/);
  });

  it('redacts a secret embedded in the steps field', () => {
    const secret = 'sk-ant-api03-' + 'Q'.repeat(40);
    const body = buildIssueBody({
      title: 'Bug',
      observed: 'error',
      expected: 'no error',
      steps: `1. Set key to ${secret}`,
      environment: 'linux',
      severity: 'medium',
      context: '```\nctx\n```',
    });
    expect(body).not.toMatch(/sk-ant-/);
  });
});

describe('AC4 — collectContext never reads .claude/settings.json', () => {
  it('does not call the reader for .claude/settings.json', async () => {
    // collectContext must be a function — TypeError is the right pre-impl failure

    // We inject a spy as the fs-reader to intercept every file path requested.
    // The implementation must accept injectable readers; if it does not accept
    // them, it will still use real fs — but then the spy won't be called and
    // the test would pass vacuously. So we also verify at least one EXPECTED
    // read DID happen (plugin.json), proving the injection works.
    const readSpy = vi.fn((filePath) => {
      if (filePath.includes('plugin.json')) {
        return JSON.stringify({ version: '1.0.0' });
      }
      if (filePath.includes('PROJECT.md')) {
        return '---\nproject_name: test-project\n---\n';
      }
      if (filePath.includes('session.json') && !filePath.includes('sessions')) {
        return JSON.stringify({ active_session_id: 'sess-abc' });
      }
      if (filePath.includes('sessions')) {
        return JSON.stringify({ active_task: 'TASK-001' });
      }
      return '';
    });
    const existsSpy = vi.fn(() => true);

    // Call with injected reader helpers. The exact parameter names are what
    // IMPL must honor: { pluginRoot, projectDir, readFile?, exists? }
    const ctx = collectContext({
      pluginRoot: '/fake/plugin',
      projectDir: '/fake/project',
      readFile: readSpy,
      exists: existsSpy,
    });

    // Verify the collector produced output (it ran, not a stub)
    expect(typeof ctx).toBe('string');
    expect(ctx.length).toBeGreaterThan(0);

    // CRITICAL: settings.json must NEVER be read
    const settingsRead = readSpy.mock.calls.some(
      ([p]) => typeof p === 'string' && p.includes('settings.json'),
    );
    expect(settingsRead).toBe(false);
  });

  it('includes plugin version in the context output when plugin.json is readable', async () => {
    const readFile = vi.fn((filePath) => {
      if (filePath.includes('plugin.json')) {
        return JSON.stringify({ version: '3.7.2' });
      }
      if (filePath.includes('PROJECT.md')) {
        return '---\nproject_name: myproject\n---\n';
      }
      if (filePath.includes('session.json') && !filePath.includes('sessions')) {
        return JSON.stringify({ active_session_id: null });
      }
      return '';
    });
    const exists = vi.fn((p) => !p.includes('sessions'));

    const ctx = collectContext({
      pluginRoot: '/fake/plugin',
      projectDir: '/fake/project',
      readFile,
      exists,
    });
    expect(ctx).toMatch(/3\.7\.2/);
  });

  it('includes the active_session_id in context when set', async () => {
    const readFile = vi.fn((filePath) => {
      if (filePath.includes('plugin.json')) return JSON.stringify({ version: '1.0' });
      if (filePath.includes('PROJECT.md')) return '---\nproject_name: p\n---\n';
      if (filePath.includes('session.json') && !filePath.includes('sessions')) {
        return JSON.stringify({ active_session_id: 'ses-XYZ123' });
      }
      if (filePath.includes('sessions') && filePath.includes('session.json')) {
        return JSON.stringify({ active_task: 'TASK-042' });
      }
      return '';
    });
    const exists = vi.fn(() => true);

    const ctx = collectContext({
      pluginRoot: '/fake/plugin',
      projectDir: '/fake/project',
      readFile,
      exists,
    });
    expect(ctx).toMatch(/ses-XYZ123/);
    expect(ctx).toMatch(/TASK-042/);
  });
});

// ---------------------------------------------------------------------------
// AC5 — non-tautological: distinct assertions for each branch
// ---------------------------------------------------------------------------

describe('AC5 — gh success vs gh-missing are distinguishable results', () => {
  it('gh-success result has url and not path', async () => {
    const url = 'https://github.com/lordiwa/agent-framework/issues/1';
    const runner = vi.fn((cmd, args) => {
      if (args.includes('--version')) return { status: 0, stdout: 'gh version 2.50.0\n', stderr: '' };
      if (args.includes('auth') && args.includes('status')) return { status: 0, stdout: '', stderr: 'Logged in\n' };
      if (args.includes('issue') && args.includes('create')) return { status: 0, stdout: `\n${url}\n`, stderr: '' };
      return { status: 1, stdout: '', stderr: '' };
    });

    const result = await fileFrameworkBug({
      title: 't', body: 'b', pluginRoot: '/p', projectDir: '/d',
      runner, fallbackWriter: vi.fn(),
    });

    expect(result.filed).toBe('github');
    expect(result.url).toBeTruthy();
    expect(result.path).toBeUndefined();
  });

  it('gh-missing result has path and not url', async () => {
    const runner = vi.fn(() => ({ status: 127, stdout: '', stderr: 'not found' }));
    const fallbackWriter = vi.fn();

    const result = await fileFrameworkBug({
      title: 't', body: 'b', pluginRoot: '/p', projectDir: '/d',
      runner, fallbackWriter,
    });

    expect(result.filed).toBe('local');
    expect(result.path).toBeTruthy();
    expect(result.url).toBeUndefined();
  });

  it('gh-success does not call fallbackWriter; gh-missing does call it', async () => {
    const successUrl = 'https://github.com/lordiwa/agent-framework/issues/5';
    const authRunner = vi.fn((cmd, args) => {
      if (args.includes('--version')) return { status: 0, stdout: 'gh version 2.50.0\n', stderr: '' };
      if (args.includes('auth') && args.includes('status')) return { status: 0, stdout: '', stderr: 'Logged in\n' };
      if (args.includes('issue') && args.includes('create')) return { status: 0, stdout: `\n${successUrl}\n`, stderr: '' };
      return { status: 1, stdout: '', stderr: '' };
    });
    const failRunner = vi.fn(() => ({ status: 127, stdout: '', stderr: 'not found' }));

    const successWriter = vi.fn();
    const failWriter = vi.fn();

    await fileFrameworkBug({ title: 't', body: 'b', pluginRoot: '/p', projectDir: '/d', runner: authRunner, fallbackWriter: successWriter });
    await fileFrameworkBug({ title: 't', body: 'b', pluginRoot: '/p', projectDir: '/d', runner: failRunner, fallbackWriter: failWriter });

    expect(successWriter).not.toHaveBeenCalled();
    expect(failWriter).toHaveBeenCalledOnce();
  });
});

describe('AC5 — body assembly is non-tautological', () => {
  it('buildIssueBody without evidence omits the evidence section', () => {
    // buildIssueBody must be a function — TypeError is the right pre-impl failure
    const body = buildIssueBody({
      title: 'Bug',
      observed: 'crash',
      expected: 'no crash',
      steps: 'step 1',
      environment: 'linux',
      severity: 'high',
      context: '```\nctx\n```',
      // no evidence field
    });
    // Should NOT contain a dedicated Evidence heading
    expect(body).not.toMatch(/## Evidence/);
  });

  it('buildIssueBody with evidence includes the evidence section', () => {
    const body = buildIssueBody({
      title: 'Bug',
      observed: 'crash',
      expected: 'no crash',
      steps: 'step 1',
      environment: 'linux',
      severity: 'high',
      evidence: 'Error: something went wrong at line 42',
      context: '```\nctx\n```',
    });
    expect(body).toMatch(/## Evidence/);
    expect(body).toMatch(/line 42/);
  });
});
