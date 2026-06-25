---
id: invalid-tags-fixture
problem: >
  A knowledge entry whose tags field violates the kebab-case pattern.
  Used by kb_schema_test_suite to verify the validator rejects it.
symptoms:
  - "Schema validation fails on tags pattern"
solution: >
  Use lowercase kebab-case for tags; no uppercase, no spaces, no underscores.
tags: ["Bad_Tag", "Another Bad"]
projects: [hivemind]
created_at: "2026-05-24T00:00:00Z"
last_seen_at: "2026-05-24T00:00:00Z"
---

Body kept short — this fixture is intentionally invalid.
