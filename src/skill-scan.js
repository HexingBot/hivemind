// src/skill-scan.js
// TASK-122 — content security gate for skill assimilation (docs/design/
// addon-packs.md §4/§7). A PURE, synchronous, dependency-free scanner over
// already-read skill content: no network, no LLM, no disk I/O of its own —
// callers (src/assimilate.js) read the files and pass the text in. This is
// the automated half of the gate; the other half (prompt-injection in the
// skill's *instructions*, which no pattern scanner can reliably catch) is a
// human-facing security-reviewer subagent verdict, injected as data into
// src/assimilate.js's gate — never computed here. See that module's
// SECURITY REVIEW BOUNDARY note for the orchestrator-side wiring.
//
// Findings are decision SUPPORT, same invariant as license classification
// (src/license-detect.js): a clean scan is never itself a write authority,
// and scan findings alone never auto-block an approve — see assimilateSkill.
//
// Patterns are deliberately conservative and anchored tightly to avoid
// false positives on ordinary prose/doc content (e.g. the word "curl" used
// in a sentence, or a plain markdown link) — see the regex comments below.

const SEVERITIES = ['high', 'medium', 'low'];

// category -> [{ severity, re }] ; `re` is a non-global per-line regex.
const PATTERN_DEFS = [
  {
    category: 'shell-exec',
    severity: 'high',
    // curl/wget piped straight into a shell interpreter -- the classic
    // "curl | sh" remote-code-execution pattern. Requires an actual pipe to
    // sh/bash/zsh, not just the word "curl" appearing in prose.
    re: /\b(curl|wget)\b[^\n|]{0,200}\|\s*(sudo\s+)?(sh|bash|zsh)\b/i,
  },
  {
    category: 'shell-exec',
    severity: 'high',
    // Direct shell/process-exec invocations across common languages.
    re: /\b(child_process\.(exec|execSync|spawn|spawnSync)|os\.system|subprocess\.(run|call|Popen|check_output|check_call))\s*\(/,
  },
  {
    category: 'network-fetch',
    severity: 'medium',
    // Programmatic HTTP calls to a literal URL -- an invocation, not a bare
    // markdown link or a URL mentioned in prose.
    re: /\b(fetch|axios\.(get|post|put)|urllib\.request\.urlopen|requests\.(get|post)|http\.request)\s*\(\s*['"`]https?:\/\//i,
  },
  {
    category: 'network-fetch',
    severity: 'medium',
    // curl/wget invoked against a URL directly (not necessarily piped to a shell).
    re: /\b(curl|wget)\s+(-{1,2}\S+\s+)*https?:\/\//i,
  },
  {
    category: 'env-credential-access',
    severity: 'high',
    // Programmatic env/credential reads: process.env.X, os.environ[...]/getenv(...).
    re: /\b(process\.env\.[A-Za-z_][A-Za-z0-9_]*|process\.env\[|os\.environ(\.get)?\(|os\.environ\[|os\.getenv\()/,
  },
  {
    category: 'filesystem-access-outside-skill',
    severity: 'high',
    // Two-or-more-level path traversal ("escaping" the skill's own dir), or
    // a known-sensitive absolute path (SSH keys, cloud credential files,
    // /etc/passwd, Windows profile env vars).
    re: /(\.\.[\\/]){2,}|\/etc\/passwd\b|\.ssh[\\/](id_rsa|id_ed25519|authorized_keys)\b|\.aws[\\/]credentials\b|%APPDATA%|\$HOME[\\/]\.ssh\b|~[\\/]\.ssh[\\/]/i,
  },
  {
    category: 'obfuscated-blob',
    severity: 'medium',
    // A long run of base64-alphabet characters -- a hallmark of an
    // obfuscated/binary payload smuggled into otherwise-textual content.
    // 80+ chars keeps this well clear of routine content like a 64-hex
    // sha256 digest or a normal-length identifier/URL slug.
    re: /\b[A-Za-z0-9+/]{80,}={0,2}\b/,
  },
];

function severityRank(sev) {
  return SEVERITIES.indexOf(sev);
}

function scanOneFile(content, location) {
  if (!content) return [];
  const lines = String(content).split(/\r?\n/);
  const findings = [];
  lines.forEach((line, idx) => {
    for (const { category, severity, re } of PATTERN_DEFS) {
      if (re.test(line)) {
        findings.push({
          category,
          severity,
          location: `${location}:${idx + 1}`,
          snippet: line.trim().slice(0, 160),
        });
      }
    }
  });
  return findings;
}

function summarizeFindings(findings) {
  const bySeverity = { high: 0, medium: 0, low: 0 };
  for (const f of findings) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
  let highestSeverity = null;
  for (const f of findings) {
    if (highestSeverity === null || severityRank(f.severity) < severityRank(highestSeverity)) {
      highestSeverity = f.severity;
    }
  }
  return { total: findings.length, bySeverity, highestSeverity };
}

/**
 * Scan skill content for risky patterns: shell/exec invocation, network/URL
 * fetch, env/credential access, filesystem access outside the skill dir, and
 * obfuscated/base64/binary blobs. Pure and synchronous -- does no I/O of its
 * own; the caller reads the file(s) and passes the text in.
 *
 * @param {string} text - the primary file's content (typically SKILL.md).
 * @param {object} [opts]
 * @param {string} [opts.location] - label used in each finding's `location`
 *   for `text` (default 'SKILL.md'); findings read `${location}:${line}`.
 * @param {{path: string, content: string}[]} [opts.files] - additional files
 *   (e.g. references/*.md) to scan in the same pass; each finding's location
 *   uses that file's own `path`.
 * @returns {{ findings: Array<{category: string, severity: 'high'|'medium'|'low', location: string, snippet: string}>, summary: {total: number, bySeverity: {high: number, medium: number, low: number}, highestSeverity: string|null} }}
 */
export function scanSkillContent(text, opts = {}) {
  const { location = 'SKILL.md', files = [] } = opts;
  const findings = [...scanOneFile(text, location)];
  for (const file of files) {
    findings.push(...scanOneFile(file.content, file.path));
  }
  return { findings, summary: summarizeFindings(findings) };
}
