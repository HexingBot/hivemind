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
//
// HONEST FRAMING (TASK-141): this is LOW-RECALL TRIAGE, not a security
// boundary. It is a fixed set of regexes against text a determined author
// can trivially restructure (a new alias, an extra indirection, a helper
// function) to evade every pattern below. Expanding recall (TASK-141 added
// destructured/aliased env reads, computed child_process access, eval/
// Function/vm sandbox escapes, non-literal fetch URLs, multi-line/MIME-
// wrapped base64, Unicode Tag-block smuggling, and cross-skill persistence
// writes) narrows the gap but never closes it — new evasions will keep
// existing. A CLEAN SCAN (zero findings) IS NOT A SAFETY ASSURANCE; it only
// raises the human/security-reviewer's prior that the content is benign.
// The only thing that reliably catches intent-in-prose is the human-facing
// security-reviewer subagent step (see src/assimilate.js's SECURITY REVIEW
// BOUNDARY note) — this scanner is decision support layered underneath it,
// never a substitute for it.

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
    category: 'shell-exec',
    severity: 'high',
    // Computed/bracket member access into a fresh child_process require --
    // evades a literal `.exec(` dot-call scan: require('child_process')['exec'](...).
    re: /require\(\s*['"]child_process['"]\s*\)\s*\[\s*['"](exec|execSync|spawn|spawnSync)['"]\s*\]\s*\(/,
  },
  {
    category: 'shell-exec',
    severity: 'high',
    // Destructured child_process import: const {exec} = require('child_process').
    re: /\b(?:const|let|var)\s*\{[^{}]{0,200}\}\s*=\s*require\(\s*['"]child_process['"]\s*\)/,
  },
  {
    category: 'shell-exec',
    severity: 'high',
    // Dynamic code execution / sandbox escapes: eval(...), new Function(...),
    // vm.runInNewContext/runInThisContext/runInContext(...). Anchored to the
    // call form (identifier immediately followed by `(`) so the bare word
    // "eval" in ordinary prose does not match.
    re: /\b(eval\s*\(|new\s+Function\s*\(|vm\.(runInNewContext|runInThisContext|runInContext)\s*\()/,
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
    category: 'network-fetch',
    severity: 'medium',
    // Programmatic HTTP calls with a NON-literal URL argument -- a bare
    // variable (`fetch(u)`) or a template literal (`` fetch(`${base}/x`) ``)
    // evades a scan anchored to a literal 'http...' string. Requires the
    // argument to be a single bare identifier immediately followed by `,`/`)`
    // (not a multi-word phrase) or a template literal, to avoid matching
    // prose like "fetch(the latest changes) from origin".
    re: /\b(fetch|axios\.(get|post|put|delete|patch)|requests\.(get|post|put|delete))\s*\(\s*([A-Za-z_$][\w$]*\s*[,)]|`)/,
  },
  {
    category: 'env-credential-access',
    severity: 'high',
    // Programmatic env/credential reads: process.env.X, os.environ[...]/getenv(...).
    re: /\b(process\.env\.[A-Za-z_][A-Za-z0-9_]*|process\.env\[|os\.environ(\.get)?\(|os\.environ\[|os\.getenv\()/,
  },
  {
    category: 'env-credential-access',
    severity: 'high',
    // Destructured env reads: `const {SECRET} = process.env` (also let/var) --
    // evades a literal `process.env.X` scan by pulling names out via pattern
    // matching instead of dot access.
    re: /\b(?:const|let|var)\s*\{[^{}]{0,200}\}\s*=\s*process\.env\b/,
  },
  {
    category: 'env-credential-access',
    severity: 'high',
    // Whole-object aliasing of process.env into a bare identifier (then used
    // later as `alias.TOKEN`) -- flags the aliasing assignment itself, since
    // the later member access on an arbitrary alias name isn't reliably
    // distinguishable from ordinary object access. Excludes `x = process.env.Y`
    // / `x = process.env[...]`, which the two patterns above already cover.
    re: /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*process\.env\s*(?![.[\w])/,
  },
  {
    category: 'env-credential-access',
    severity: 'high',
    // Bundler-injected env access (Vite/ESM): import.meta.env.X / import.meta.env[...].
    re: /\bimport\.meta\.env(\.[A-Za-z_$][\w$]*|\[)/,
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
  {
    category: 'unicode-tag-smuggling',
    severity: 'high',
    // Unicode Tag-block characters (U+E0000-U+E007F) render invisible in
    // normal viewers/editors but are semantically processed by an LLM -- a
    // known prompt/instruction-smuggling channel. Any occurrence is
    // anomalous; legitimate skill prose has no reason to contain them.
    re: /[\u{E0000}-\u{E007F}]/u,
  },
  {
    category: 'persistence-write',
    severity: 'high',
    // A filesystem WRITE (Node writeFileSync/fs.writeFile/fs.promises.writeFile)
    // whose target path touches another agent-config surface outside the
    // skill's own directory: a .claude/ segment, a >=2-level path escape, or
    // a settings.json specifically preceded by a directory escape. A bare
    // `settings.json` / `./config/settings.json` with no .claude/ segment and
    // no escape is the skill's OWN file -- AC1 scopes this category to
    // outside the skill dir, so the settings.json alternative must stay
    // qualified by an out-of-dir signal rather than matching on filename alone.
    re: /\b(writeFileSync|fs\.writeFile|fs\.promises\.writeFile)\s*\([^)\n]{0,300}(\.claude[\\/]|(\.\.[\\/]){2,}|(\.\.[\\/])[^)\n]{0,200}settings\.json)/i,
  },
  {
    category: 'persistence-write',
    severity: 'high',
    // Python `open(path, 'w'|'a')` targeting the same kind of qualified path,
    // in either argument order.
    re: /\bopen\s*\([^)\n]{0,300}(\.claude[\\/]|(\.\.[\\/]){2,}|(\.\.[\\/])[^)\n]{0,200}settings\.json)[^)\n]{0,300}['"][wa][+b]?['"]\s*\)|\bopen\s*\([^)\n]{0,300}['"][wa][+b]?['"][^)\n]{0,300}(\.claude[\\/]|(\.\.[\\/]){2,}|(\.\.[\\/])[^)\n]{0,200}settings\.json)/i,
  },
  {
    category: 'persistence-write',
    severity: 'high',
    // Shell append/overwrite redirection into the same kind of qualified path.
    re: />{1,2}\s*[^\n|]{0,80}(\.claude[\\/]|(\.\.[\\/]){2,}|(\.\.[\\/])[^\n|]{0,80}settings\.json)/i,
  },
];

// A base64-alphabet run split across multiple consecutive lines (arbitrary
// wrapping, or the standard 76-col MIME wrap) evades the single-line 80+
// char PATTERN_DEFS regex above, since no *one* line crosses the threshold.
// This is a supplementary WHOLE-TEXT pass (not per-line), additive to
// PATTERN_DEFS: it joins consecutive lines that are themselves entirely
// base64-alphabet characters and flags the run once its combined length
// crosses the same 80-char bar used for the single-line case. A lone
// short/medium line (e.g. a 64-hex sha256 digest) never forms a run by
// itself, so it stays clear of this check the same way it clears the
// single-line one.
const MULTILINE_BASE64_LINE_RE = /^[A-Za-z0-9+/]{16,}={0,2}$/;
const MULTILINE_BASE64_MIN_TOTAL = 80;

function scanMultilineBase64(content, location) {
  if (!content) return [];
  const lines = String(content).split(/\r?\n/);
  const findings = [];
  let runStart = -1;
  let runTotalLen = 0;
  const flushRun = (endIdxExclusive) => {
    if (runStart >= 0 && endIdxExclusive - runStart >= 2 && runTotalLen >= MULTILINE_BASE64_MIN_TOTAL) {
      findings.push({
        category: 'obfuscated-blob',
        severity: 'medium',
        location: `${location}:${runStart + 1}`,
        snippet: lines[runStart].trim().slice(0, 160),
      });
    }
    runStart = -1;
    runTotalLen = 0;
  };
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (MULTILINE_BASE64_LINE_RE.test(trimmed)) {
      if (runStart === -1) runStart = idx;
      runTotalLen += trimmed.length;
    } else {
      flushRun(idx);
    }
  });
  flushRun(lines.length);
  return findings;
}

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
  findings.push(...scanMultilineBase64(content, location));
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
 * Scan skill content for risky patterns: shell/exec invocation (including
 * computed/destructured child_process access and eval/Function/vm sandbox
 * escapes), network/URL fetch (literal or non-literal/variable/template-
 * literal URL), env/credential access (dot, bracket, destructured, aliased,
 * import.meta.env), filesystem access outside the skill dir, cross-skill
 * persistence writes (e.g. targeting .claude/settings.json), obfuscated/
 * base64/binary blobs (single-line or split across lines / MIME-wrapped),
 * and Unicode Tag-block smuggling characters. Pure and synchronous -- does
 * no I/O of its own; the caller reads the file(s) and passes the text in.
 *
 * LOW-RECALL TRIAGE, NOT A SAFETY ASSURANCE: this is a fixed set of anchored
 * regexes. A clean scan (zero findings) only raises the human/security-
 * reviewer's prior that the content is benign -- it never certifies safety,
 * and a motivated author can restructure code to evade any single pattern
 * here. See the module header for the full framing.
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
