# Knowledge Base — Lessons Learned

This directory is the team's portable lessons-learned store. Every entry here is a self-contained Markdown file that the Researcher subagent consults **before** invoking web search. The directory is designed to be copied wholesale into another project: drop `knowledge/` in, and the receiving project gets a working KB with no edits required.

## What goes here

Reusable lessons. The kind of thing where a future you (or a future Researcher) will spend two hours rediscovering, and where having written it down once will save the team that time forever.

Examples of good entries:

- "Node's `fs.rename` on Windows is not strictly atomic when the destination exists" — with the workaround.
- "`*.log` in a project-level `.gitignore` will quietly swallow `state/sessions/<id>/lifecycle.log`" — with the carve-out you need.
- "OneDrive sync briefly holds file handles open, causing EBUSY on rename" — with the retry policy.

Examples of bad entries (do NOT put these here):

- Project-specific paths or task IDs (`fixes TASK-004 by writing to C:\Users\me\repo\state\...`). Use the project's own task store or comments for that.
- Generic tutorial content already in good library docs.
- One-off scratch notes. If you wouldn't expect a second project to benefit, it doesn't belong here.

## How to add an entry

1. Pick a kebab-case `<id>`. The filename must be `<id>.md` and the frontmatter `id:` field must match.
2. Fill in the required frontmatter fields per `schema.md`.
3. Write the body in generic terms. **No absolute filesystem paths** — refer to files by relative or abstract names (`the bundle's session.json`, not `C:\Users\me\repo\state\sessions\<id>\session.json`). The deny-list is enforced by the test suite.
4. Commit the file. The Orchestrator updates `last_seen_at` automatically when the entry is reused.

## How the lookup procedure works

The Researcher subagent, on receiving a research question, runs this procedure deterministically before any web search:

1. **Tokenize** the question. Lowercase, drop English stopwords, keep tokens of length ≥ 3.
2. **Three-pass grep** over `knowledge/entries/*.md`:
   - tag matches (weight 3),
   - symptom matches (weight 2),
   - body / problem matches (weight 1).
3. **Score and rank** candidates. Read the top 3.
4. If any candidate's `solution` answers the question, the Researcher returns it citing the entry id and **skips** web search.
5. Otherwise, the Researcher proceeds to web search, and at the end **proposes** (does not write) a new entry for the Orchestrator to commit after human approval.

This is in `.claude/agents/researcher.md` as a mandatory step. The Researcher itself is read-only with respect to `knowledge/`; the Orchestrator writes the `last_seen_at` updates and any new entries via atomic temp+rename writes.

## Draft entries (`proposed/`, TASK-105)

Unvetted knowledge entries — captured automatically by the Orchestrator at ticket close when a
review recorded a HIGH finding or the ticket needed an RC (REQUEST-CHANGES) loop — live in
`knowledge/proposed/`, never in `knowledge/entries/`. They use the same schema and are excluded
from the lookup procedure entirely (step 2 below only ever scans `knowledge/entries/*.md`). See
`schema.md`'s "Draft entries" section for the full write/promote/discard contract.

## Knowledge graph (`graph/`)

`knowledge/graph/` holds a typed graph that links the artifacts the framework
already tracks. It is a **single file**, `graph.json`, validated against
`graph/schema.json` (JSON Schema draft 2020-12):

```
{ "schema_version": 1, "nodes": [...], "edges": [...] }
```

**Node types** (the `type` field): `knowledge_entry` (references
`knowledge/entries/*.md`), `task` (references `tasks/TASK-NNN.json`),
`decision` (references a session bundle's decisions), and `skill` (references
`.claude/skills/<name>/`). Every node carries a stable `id`, a `ref` pointing
at its source artifact, and a human-readable `label`.

**Edge relations** (the `relation` field): `learned-in`, `blocks`,
`supersedes`, `uses`, `produced-by`, `relates-to`. Edges must reference
existing node ids — referential integrity is enforced on every write, and
removing a node cascades its edges.

**The index-not-copy principle.** The graph is an *index over* existing
state, never a second copy of it. Nodes reference entries, tasks, decisions,
and skills by stable pointer (`ref`); they do not duplicate their content.
If an entry's body changes, the graph does not need to change — only when
artifacts are created, deleted, or newly related. This keeps the graph cheap
to maintain and impossible to drift into a competing source of truth.

All reads and writes go through `src/knowledge-graph.js`, which validates
against the schema, enforces referential integrity before any disk mutation,
writes atomically, and serializes deterministically (nodes sorted by id,
edges by from/to/relation) so git diffs stay readable. A grouped visual view
is served at `/graph` by the task-board server.

## Portability rule

To stay portable across projects:

- Entry bodies must NOT contain absolute paths (`C:\`, `/Users/`, `/home/`, `\\?\`). The frontmatter `projects` array lists which projects have validated the lesson — it is kept on export and appended to on first reuse in a new project.
- The schema (`schema.json`) and human-readable doc (`schema.md`) travel with the entries. A receiving project drops the entire `knowledge/` directory in and is immediately operational.

See `tasks/TASK-004.research.md` §F for the full design rationale.
