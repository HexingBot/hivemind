# Knowledge Entry Schema (human-readable)

The machine-checkable schema is `schema.json` in this directory; the test suite validates every entry against it. This document is the human-friendly version.

## File layout

One entry per file under `entries/<id>.md`. Filename slug MUST equal the frontmatter `id` field.

## Required frontmatter

```yaml
---
id: <kebab-case-slug>                         # matches filename minus .md; see schema.json (excludes Windows reserved device names: con, prn, aux, nul, com0-9, lpt0-9)
problem: >                                    # 1-paragraph statement of the problem (10..1000 chars)
  ...
symptoms:                                     # array of strings, >= 1
  - "..."
solution: >                                   # markdown allowed; >= 10 chars
  ...
tags: [windows, atomic-write, filesystem]     # array of lowercase-kebab strings, >= 1
projects: [hivemind]                 # array of project names this entry has been validated in, >= 1
created_at: "YYYY-MM-DDTHH:MM:SSZ"            # RFC 3339, original creation
last_seen_at: "YYYY-MM-DDTHH:MM:SSZ"          # RFC 3339, updated by Orchestrator on reuse
---
```

## Optional frontmatter

```yaml
source_urls:                                  # array of URLs the lesson is sourced from
  - "https://..."
supersedes: []                                # array of entry ids this one replaces
superseded_by: null                           # entry id or null
```

## Body

Free-form Markdown after the closing `---` line. Constraints:

- **No absolute filesystem paths.** The test suite rejects entries whose body matches `C:\`, `/Users/`, `/home/`, or `\\?\`. Refer to files generically ("the session bundle's `session.json`", not `C:\Users\you\repo\state\sessions\<id>\session.json`).
- Examples and anti-patterns are welcome. Code blocks are encouraged.

## Field semantics

| Field | Set by | Updated by | Purpose |
|-------|--------|------------|---------|
| `id` | author | never | stable handle; matches filename |
| `problem` | author | author (on revision) | one-paragraph problem statement; what symptom you'd grep for |
| `symptoms` | author | author | error messages, observable bad behavior — these are the strings the lookup procedure scores most heavily |
| `solution` | author | author | the answer; markdown allowed |
| `tags` | author | author | lowercase-kebab, highest weight in lookup |
| `projects` | author | Orchestrator (appends on reuse) | provenance; useful for triaging stale entries |
| `created_at` | author | never | original write |
| `last_seen_at` | author | Orchestrator (on KB reuse) | most recent time a Researcher reused this entry — recency tiebreaker in ranking |
| `source_urls` | author | author | external sources cited by the lesson |
| `supersedes` / `superseded_by` | author | author | for entries that replace earlier ones |

## Lookup ranking

Tokenize the question (lowercase, strip stopwords, keep ≥3-char tokens), then:

```
score(entry) = 3*(tag matches) + 2*(symptom matches) + 1*(problem/body matches)
```

Tie-break by most recent `last_seen_at`. Top 3 are read; the first whose `solution` answers the question is returned (`used: true`).

## Why kebab-case ids

- Filesystem-safe on Windows, macOS, Linux.
- Human-readable in directory listings.
- Stable across renames of the underlying tech (the tech may move, but the lesson id can stay).

## Draft entries (`knowledge/proposed/`, TASK-105)

Any reviewer HIGH-severity finding or REQUEST-CHANGES (RC) loop on a ticket produces a draft
knowledge entry at close, written by the Orchestrator via `writeKnowledgeEntry({ repoRoot, entry,
draft: true })` (`src/knowledge.js`) — without per-entry human approval. Drafts use the exact same
frontmatter schema as a vetted entry; the only difference is WHERE they live.

**Design decision: a sibling directory, not a `vetted: false` flag.** Two designs were on the
table: (a) add a `vetted: false` frontmatter flag entries carry inside `knowledge/entries/` itself,
or (b) a separate `knowledge/proposed/` directory holding the exact same schema. (b) was chosen: it
needs no `schema.json` change, and `lookupKnowledge` already only scans `knowledge/entries/` — so
drafts are excluded from ranking entirely, by construction, with zero extra conditional on the hot
lookup path. A flag-based design would have required every lookup call site to remember to filter
on `vetted !== false`, which is exactly the kind of silent-skip failure mode this ticket exists to
close.

**Promotion, batched at Gate 5 consolidation (curator, not scribe):** the human does not approve
drafts one at a time. At the consolidation checkpoint (see `commands/loop.md`'s Gate 5) the human
reviews the batch of files under `knowledge/proposed/` and either:

- **promotes** one — call `promoteDraftEntry({ repoRoot, id })` (`src/knowledge.js`, TASK-111 AC2).
  It reads the draft, validates and writes it to `knowledge/entries/` (internally
  `writeKnowledgeEntry({ repoRoot, entry, draft: false })`, so an already-vetted id collision
  throws `E_KB_EXISTS` with nothing touched), and only THEN unlinks the `knowledge/proposed/<id>.md`
  copy — write-then-unlink ordered so a crash mid-promotion leaves at worst a harmless duplicate,
  never a lost draft. This replaces the previous two manual, non-atomic steps (re-write, then a raw
  `fs` delete outside any validated path); or
- **discards** one — delete the file.

A promoted entry that gets linked into the knowledge graph (`knowledge/graph/graph.json`) mints a
`ke-<slug>` node id per the canonical id shapes convention — never a raw filename or ticket key
(see the orchestrator-routing skill's "Recording decision→task edges" section).
