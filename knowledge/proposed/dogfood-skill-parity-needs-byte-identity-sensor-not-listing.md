---
id: dogfood-skill-parity-needs-byte-identity-sensor-not-listing
problem: >-
  A plugin-shipped skill kept in two places (plugin-root skills/<id>/ AND the
  dev-repo .claude/skills/<id>/ parity copy) is only truly guarded when a sensor
  BYTE-COMPARES the two copies. Adding the skill to a directory-LISTING
  enumeration (e.g. REPO_LOCAL_SKILLS in plugin-scaffold.spec.js) pins that the
  plugin-root dir shows up in the listing, but never reads the .claude/skills
  copy and never compares bytes — so future drift on either copy ships uncaught.
symptoms:
  - >-
    A new dogfood/plugin skill is added to a listing/enumeration array and the
    suite goes green, but no test reads the second parity copy
  - >-
    Two SKILL.md copies are byte-identical today yet nothing fails if one drifts
    by a byte
  - >-
    Sibling dogfood skills each have a dedicated *-skill.spec.js byte-identity
    guard, but the new one does not
solution: >-
  For every dogfood/plugin skill that ships a plugin-root copy + a
  .claude/skills parity copy, add a dedicated byte-identity sensor mirroring the
  sibling pattern (tests/graphify-skill.spec.js): assert BOTH copies exist,
  carry the required frontmatter, and are readFileSync/Buffer.equals
  byte-identical. A listing-enumeration entry (REPO_LOCAL_SKILLS) is necessary
  but NOT sufficient — it guards presence-in-listing, not copy equality. This
  added sensor is an acceptance-criterion requirement, not test accretion, so it
  stays within the uat-only new-test budget. Red-green plant it (corrupt one
  copy by a byte -> fails; restore -> green). Caught at review on TASK-136
  (hivemind-assimilate-skill: the parity copy existed but no sensor read it).
tags:
  - testing
  - parity-sensor
  - skills
  - plugin
  - dogfood
  - byte-identity
  - addon-surface
projects:
  - hivemind
source_tier: T2
created_at: '2026-07-09T04:59:09.560Z'
last_seen_at: '2026-07-09T04:59:09.560Z'
---

