---
id: windows-atomic-rename-not-truly-atomic
problem: >
  Node's `fs.rename` on Windows is not strictly atomic when the
  destination file already exists. Internally it uses `MoveFileEx` with
  the replace-existing flag, which is a multi-step operation rather than
  a single atomic swap. A crash mid-operation can leave the target
  missing while the source temp file still exists on disk.
symptoms:
  - "EBUSY on rename"
  - "ERR_FS_RENAME_NONEXISTENT or similar partial-state failures"
  - "Target file briefly missing after a crash"
  - "Antivirus or backup software holding a handle on the freshly-closed tmp"
solution: >
  Use the same-directory temp-and-rename recipe and combine it with an
  orphan-tmp sweep on the next read:

  1. Open a sibling temp file with `O_CREAT|O_EXCL|O_WRONLY` so two
     writers can never collide on the same temp name.
  2. Write all bytes, `fsync` (maps to `FlushFileBuffers` on Windows),
     then `close`.
  3. Rename temp into target. Retry up to 5 times with 50 ms backoff on
     `EBUSY` / `EPERM` — antivirus and backup tools can briefly hold a
     handle on the just-closed file.
  4. If the rename ultimately fails, leave the temp file on disk. Do not
     unlink it.
  5. On the next read, sweep the directory for orphan `<target>.tmp.*`
     siblings. If the target exists and parses, delete the orphans. If
     the target is missing or unparseable, promote the newest valid
     orphan via rename.

  This gives "last writer wins" semantics on the field set, which is
  what users expect.

tags: [windows, atomic-write, filesystem, node]
projects: [hivemind]
created_at: "2026-05-25T00:00:00Z"
last_seen_at: "2026-05-25T00:00:00Z"
source_urls:
  - "https://github.com/jprichardson/node-fs-extra/issues/835"
supersedes: []
superseded_by: null
source_tier: T3
---

## Why `fs.rename` is not strictly atomic on Windows

POSIX `rename(2)` over an existing destination is a single atomic swap
at the inode level. Windows has no equivalent primitive; `MoveFileEx`
with `MOVEFILE_REPLACE_EXISTING` is implemented as something close to
"unlink target, then move source to target's name." A crash between
those two steps leaves the target missing.

There is `ReplaceFile`, which is closer to atomic, but it requires a
native binding and adds platform-specific behavior. The recipe above
sidesteps this by accepting that mid-write crashes can happen and
designing the next read to recover gracefully.

## Anti-patterns

- **`fs.writeFileSync(target, payload)` directly.** Truncates the target
  before writing the new content. A crash mid-write loses the old
  content AND fails to land the new content.
- **`fs.writeFileSync(target, payload, { flag: 'wx' })`** then deleting
  the old target separately. Same race window between unlink and write.
- **Silent retry on every error code.** Only retry on `EBUSY` and
  `EPERM`. Retrying on `ENOENT` or `EACCES` hides real bugs.

## Antivirus interaction

On Windows, Windows Defender (and most third-party AV) briefly scans
files as they are closed. During that scan window — typically tens of
milliseconds — the AV holds a read handle that blocks rename, producing
`EBUSY`. The 5×50 ms retry policy above handles the median case
cleanly. Longer scans (large files, deep heuristics) can exceed 250 ms;
if that becomes a real problem the policy can be widened, but for the
small JSON/Markdown files the harness writes, 250 ms is comfortable.

## Path-length gotcha

Windows without long-path support caps total path at 260 characters.
Recipes that nest tmp files several directories deep can hit this even
when the target path is short. Keep the temp name as a sibling of the
target — same directory, suffix `.tmp.<pid>.<rand>` — and the path stays
the same length as the target.

## Cross-platform note

The recipe is harmless on POSIX. Same-directory temp+rename is the
POSIX best practice already; the EBUSY retry just never triggers there.
Writing the recipe once and shipping it everywhere is cleaner than
branching on `process.platform === 'win32'`.
