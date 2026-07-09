---
id: a-format-sensor-must-be-checked-against-the-authoritative-schema
problem: >-
  A sensor written to lock a file format can itself encode the WRONG format.
  When it does, it passes green while the artifact is actually malformed against
  the real (external) schema — so the sensor actively HIDES the bug and lets it
  ship. TASK-138: the plugin hooks/hooks.json shipped in a flat shape that
  Claude Code rejects at load (expected record, received undefined at path
  [hooks]); the existing tests/plugin-hooks-scaffold.spec.js asserted that same
  flat shape, so it was green the whole time.
symptoms:
  - >-
    A format/scaffold sensor is green but the real consumer (CLI, runtime,
    plugin loader) rejects the file
  - The bug ships despite having a dedicated test for that exact file
  - >-
    Fixing the file to the correct schema BREAKS the pre-existing sensor
    (because the sensor encoded the old wrong shape)
solution: >-
  When a sensor asserts a file conforms to an EXTERNAL schema (a plugin
  manifest, a hook config, a CLI config), verify the asserted shape against the
  authoritative source (the official schema/doc), not against whatever the file
  currently is. A sensor that mirrors the artifact tautologically proves
  nothing. Cross-check the format once against the doc, and make the sensor
  non-vacuous by proving it fails on the known-bad shape (a negative fixture).
  If a fix to the artifact breaks an existing format sensor, that sensor was
  likely encoding the wrong format — correct it to the authoritative schema
  (preserving the original checks intent), do not just re-mirror the new file.
  Authoritative source example: Claude Code plugin hooks require a top-level
  "hooks" object wrapping the event map, and each entry needs "matcher" as a
  sibling of a nested "hooks" array of {type, command} objects
  (code.claude.com/docs/en/plugins.md, "Migrate hooks").
tags:
  - testing
  - sensor
  - schema
  - plugin
  - hooks
  - external-contract
  - tautological-test
projects:
  - hivemind
source_tier: T2
created_at: '2026-07-09T14:06:40.518Z'
last_seen_at: '2026-07-09T14:06:40.518Z'
---

