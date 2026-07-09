---
id: license-is-not-a-safety-gate-for-third-party-adoption
problem: >-
  Adopting third-party code/skills based on a permissive or known license treats
  a LEGAL signal as a SAFETY signal. A license says nothing about whether the
  content is safe to run, and a self-declared license field (e.g. in a skill
  manifest/frontmatter) is trivially forgeable — so auto-adopting on
  "permissive" lets unreviewed, possibly hostile content in.
symptoms:
  - A pipeline auto-installs/adopts when the license classifies as permissive
  - >-
    Trusting a self-declared license: field in a manifest/frontmatter as
    authoritative
  - Equating "MIT/Apache" with "safe to execute"
  - >-
    No content review or human sign-off before pulling in third-party
    instructions/code
solution: >-
  Separate the two concerns explicitly. LEGAL: license classification, derived
  ONLY from trustworthy sources (matched license TEXT or a registry API like
  GitHub licensee) — never a self-asserted label — and used only as
  decision-support on a review card. SAFETY: a mandatory, license-independent
  content review (automated risky-pattern scan for shell/network/credential
  access + obfuscation, PLUS a reviewer that reads the actual content INCLUDING
  its instructions, since prompt-injection in a skill is the risk a code scanner
  cannot see). Then require explicit human sign-off. No third-party content
  adopts without approval — not even a permissively-licensed one. Enforce a
  tested no-write-without-approve invariant. Surfaced by the TASK-120 UAT: a
  real skill (GSAP) was genuinely MIT yet the correct posture was still
  fail-closed until reviewed.
tags:
  - security
  - supply-chain
  - license
  - assimilate
  - third-party
  - addon-packs
projects:
  - hivemind
source_tier: T2
created_at: '2026-07-08T18:38:12.142Z'
last_seen_at: '2026-07-08T18:38:12.142Z'
---
## Why it happens
License detection is easy and feels like due diligence, so it gets overloaded into a trust decision it cannot bear. "Permissive" answers "may I legally copy this," not "is this safe to run." And the cheapest license signal — a self-declared field in the artifact itself — is exactly the one an attacker controls, so ranking it as authoritative inverts the trust model.

## The general lesson
Legal clearance and safety are orthogonal gates. Trust must live at vet time, human-in-the-loop, over the actual content — not be inferred from a label. For agent skills specifically, the highest-value review is a human/LLM read of the instruction text for prompt-injection, which no license check or static scanner catches. Default to fail-closed: absent an explicit approval after review, write nothing.

## Detection
An invariant test that sweeps {permissive, copyleft, unknown} x {no-decision, decline} and asserts nothing is ever written without an explicit approve locks the policy. A code path that adopts on classification alone is the smell.
