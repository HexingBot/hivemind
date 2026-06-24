---
id: windows-atomic-rename-not-truly-atomic
problem: >
  Node's fs.rename on Windows is not strictly atomic when the destination
  exists, because MoveFileEx is a multi-step operation under the hood.
symptoms:
  - "EBUSY on rename"
  - "Target file briefly missing after a crash"
solution: >
  Write to a same-directory tmp file, fsync, rename, and on the next read
  sweep for orphaned tmp siblings. Promote the tmp file if the target is
  missing; delete it if the target is present and current.
tags: [windows, atomic-write, filesystem]
projects: [hivemind]
created_at: "2026-05-24T00:00:00Z"
last_seen_at: "2026-05-24T00:00:00Z"
source_urls:
  - "https://github.com/jprichardson/node-fs-extra/issues/835"
supersedes: []
superseded_by: null
---

Body — describes the workaround in generic terms with no absolute paths.
Refer to "the session bundle's session.json" rather than any concrete path.
