---
description: Report a bug in the hivemind plugin itself. Gathers the bug details (observed behavior, expected behavior, steps to reproduce, environment, severity, optional evidence) conversationally for a human (or directly from an agent), scrubs secrets from the body, then files the issue on GitHub via the gh CLI or writes it to a local file if gh is unavailable or unauthenticated.
panel_safe: true
---

# /hivemind:report-framework-bug

File a bug report **against the hivemind plugin** (not a project ticket).
The report lands on GitHub at `HexingBot/hivemind/issues` when the gh CLI is
available and authenticated, or in a local Markdown file under
`<projectDir>/.claude/framework-bug-reports/` as a durable fallback.

All content is automatically secret-scrubbed (GitHub tokens, Anthropic/OpenAI API
keys, AWS access key IDs, Bearer headers, URI-userinfo credentials such as
`scheme://user:pass@host`, and `*_TOKEN`/`*_SECRET`/`*_KEY`/`*_PASSWORD`/`*_AUTH`/
bare `PASSWORD=` env-var assignments) before any upload. **Review the scrubbed
output before confirming submission** — the scrubber catches common patterns but
cannot guarantee coverage of every custom secret format.

This command is designed for **two kinds of caller**:

- **A human** typing `/hivemind:report-framework-bug` — gather the details
  conversationally (Step 1), one question at a time.
- **An agent** invoking this command with the bug details already in hand — skip
  the dialogue, map the details onto the fields in Step 2. **Do not file
  automatically** — see the confirm gate immediately below.

---

## Agent confirm gate (required before any GitHub egress)

An agent caller MUST present the assembled, scrubbed issue body to the human and
collect an explicit confirmation (e.g. "yes, file this") before proceeding. Do not
call `gh issue create` (i.e. do not run Step 2) without that confirmation — the
scrubber catches common patterns but is not a substitute for human review of
content that is about to leave the machine.

If no human is available to confirm (e.g. running unattended in loop-mode), treat
the gate as blocking: do not file on GitHub, and write the report to the local
fallback only.

This gate applies to the GitHub-filing path only — the local-file fallback never
requires confirmation, since it never leaves the machine.

---

## Step 1 — Gather the report (skip if you already have the details)

For a human, ask **one question at a time**, keep each prompt to one line, and stop
asking as soon as you have enough to write a crisp bug report:

- **Title** — one-line summary of the defect.
- **Observed** — the observed/actual behavior (what actually happened).
- **Expected** — the correct behavior (what should have happened).
- **Steps to reproduce** — a numbered list; push for the minimal sequence.
- **Environment** — OS, plugin version, branch/commit, command used, when known.
- **Severity** — how bad is it? (critical / high / medium / low). If unsure, infer
  it from the impact and offer "this looks like a HIGH — agree?".
- **Evidence** *(optional)* — error text, stack trace, or log snippet. Include
  verbatim; do not paraphrase error strings.

If a field is genuinely unknowable, write `unknown` rather than inventing it.

---

## Step 2 — Invoke the CLI

Once you have all the required fields, invoke the bundled reporter via the Bash
tool. The body is assembled and scrubbed automatically:

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/report-framework-bug.cjs \
  --title  "<one-line bug title>" \
  --observed  "<what actually happened>" \
  --expected  "<what should have happened>" \
  --steps  "<numbered reproduction steps>" \
  --environment  "<OS / version / branch / command>" \
  --severity  "<critical|high|medium|low>" \
  [--evidence "<verbatim error text or stack trace>"]
```

The CLI:
1. Auto-collects a safe context block (plugin version, OS, active session/task key).
2. Assembles the full issue body from the supplied fields.
3. Runs `scrubSecrets` on the assembled body.
4. Detects gh availability and authentication status.
5. Files the issue on GitHub (`HexingBot/hivemind`) if gh is available and
   authenticated; otherwise writes the scrubbed body to a local fallback file.
6. Prints the issue URL (GitHub path), or the local file path together with the
   **actual reason** filing didn't happen (fallback path — see Step 3).

---

## Step 3 — Confirm the outcome

**GitHub path** — report the new issue URL to the caller:

> Filed framework bug: https://github.com/HexingBot/hivemind/issues/NNN

**Local fallback path** — the CLI's own console output names the specific reason
filing didn't happen (e.g. `gh CLI not found`, `gh not authenticated`, or the exact
`gh issue create` error such as a repo-not-found failure). Relay that **specific**
reason to the caller — do not paraphrase it into a generic "gh unavailable or
unauthenticated" explanation, since gh can be present and authenticated and still
fail to file (wrong repo, disabled issues, etc.):

> Could not file on GitHub (`<reason from the CLI output>`). The scrubbed bug
> report has been saved to:
> `<projectDir>/.claude/framework-bug-reports/bug-report-<timestamp>.md`
>
> To file it on GitHub manually, run:
>   gh issue create --repo HexingBot/hivemind --title "<title>" --body-file <path>
> Or authenticate with `gh auth login` and re-run this command.

In either case, remind the caller that the body was secret-scrubbed and they should
review it before submitting if they filed manually.

---

## Severity guide

| Severity | Use when |
|---|---|
| `critical` | data loss, security hole, crash on the main path, release blocker |
| `high` | a primary use case is broken with no easy workaround |
| `medium` | broken edge case, or a workaround exists |
| `low` | cosmetic, rare, or minor annoyance |
