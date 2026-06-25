---
problem: >
  A knowledge entry whose frontmatter is missing the required id field.
  Used by kb_schema_test_suite to verify the validator rejects it.
symptoms:
  - "Schema validation fails"
solution: >
  Add the id field; it must match the filename slug and the kebab-case pattern.
tags: [schema, validation]
projects: [hivemind]
created_at: "2026-05-24T00:00:00Z"
last_seen_at: "2026-05-24T00:00:00Z"
---

Body kept short — this fixture is intentionally invalid.
