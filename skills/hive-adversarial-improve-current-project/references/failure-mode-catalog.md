# Failure-mode catalog (supply-chain / third-party content inputs)

Seed step 3 of the hive-adversarial-improve-current-project protocol from this list, not from
improvisation. Each category below is a concrete, cited class of untrusted input that a trust-boundary
gate in this project must reject — not a hypothetical. Chain categories together in a single probe
where plausible: the finding that **~91% of malicious skills combine prompt-injection WITH
traditional malware** (rather than relying on either alone) means a review that only exercises the
categories separately is under-testing the realistic failure surface.

## Categories

- **Credential exfiltration** — instructions or code that read environment variables, credential
  files, or session tokens and route them to an outside destination (a URL, a "logging" endpoint,
  an encoded parameter). The gate must treat such content as inert data, not honor it.
- **Command execution** — a shell-exec, `child_process`/`subprocess`/`os.system` call, or a
  `curl | sh` style pipe, invoked from content that should have been inert data (user input, a
  config value, a parsed file).
- **Data routing / proxy substitution** — content that silently redirects a legitimate-looking
  network call (an API endpoint, a package registry, a webhook URL) to an outside proxy that can
  observe or alter the traffic.
- **Persistence** — a write into another local context file that will be read automatically on a
  later session or by a different tool — e.g. shell profile files, auto-loaded config, or a
  scheduled job definition.
- **Hidden Unicode-tag input** — instructions smuggled inside the Unicode Tag block
  (U+E0000–U+E007F), which renders invisibly in most UIs but is still tokenized and read by an LLM
  processing the raw text.
- **DDIPE (Document-Driven Implicit Payload Execution)** — logic embedded inside code examples,
  config templates, or "sample usage" snippets that a reader copies and runs verbatim, trusting the
  surrounding document's authority rather than reading the snippet critically.
- **Typosquatting** — a dependency, package, or resource name deliberately close to a legitimate,
  trusted one, relying on a rushed or careless adoption step to pull in the wrong artifact.
- **License-field spoofing** — a self-declared `license` field (in `package.json` or similar) that
  misrepresents the actual license terms or omits a restrictive clause, exploiting the fact that
  license classification is decision support a human trusts, not a verified fact.
- **Indirect injection via fetched third-party content** — a problem that doesn't live in the
  input itself but arrives later, embedded in content this project fetches at runtime (a web page,
  an API response, a document) and then treats as trusted input.

## Combining categories

Design at least one probe per review run that chains two or more categories in sequence (e.g. a
hidden Unicode-tag input that, once honored, performs credential exfiltration) — this mirrors the
~91% combined-failure finding below and catches gates that only check for isolated indicators.

## Sparse-literature components (installers, profilers, and similar)

For component types with thin published literature (installers, environment profilers, and other
infrastructure-adjacent surfaces), fall back to two general-purpose techniques instead of waiting
for a named catalog entry to exist:

1. Map **STRIDE** (Spoofing, Tampering, Repudiation, Information disclosure, Denial of service,
   Elevation of privilege) against each trust boundary named in protocol step 1.
2. Apply the OWASP ASI02 tool-misuse question directly: **can the system verify that a given action
   reflects legitimate intent within its approved boundaries** — or will it honor whatever a
   plausible-looking instruction tells it to?

## Cited sources

- OWASP Top 10 for Agentic Applications 2026 (ASI02 — Tool Misuse):
  https://genai.owasp.org/download/52117
- Snyk, "ToxicSkills: malicious AI agent skills" (ClawHub):
  https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/
- Cloud Security Alliance, "SKILL.md: Agent Context Poisoning" research briefing:
  https://labs.cloudsecurityalliance.org/research/briefing-csa-research-note-skill-md-agent-context-poisoning/
- "Agent Skills" prompt-injection study, arXiv:2510.26328:
  https://arxiv.org/pdf/2510.26328
- reversec, "Skill Issues: Compromising Claude Code with Malicious Skills" (Agents, Part 1):
  https://labs.reversec.com/posts/2026/05/skill-issues-compromising-claude-code-with-malicious-skills-agents-part-1
- MalSkillBench, arXiv:2606.07131 (source of the ~91% combined prompt-injection + traditional
  malware finding cited above):
  https://arxiv.org/pdf/2606.07131
