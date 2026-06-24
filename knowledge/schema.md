# Knowledge Entry Schema (human-readable)

The machine-checkable schema is `schema.json` in this directory; the test suite validates every entry against it. This document is the human-friendly version.

## File layout

One entry per file under `entries/<id>.md`. Filename slug MUST equal the frontmatter `id` field.

## Required frontmatter

```yaml
---
id: <kebab-case-slug>                         # matches filename minus .md, ^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$
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
