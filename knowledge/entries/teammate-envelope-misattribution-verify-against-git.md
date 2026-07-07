---
id: teammate-envelope-misattribution-verify-against-git
problem: >-
  Claude Code teammate messages can be delivered with the WRONG teammate_id
  envelope: a finishing agent's substantive hand-off arrived attributed to a
  different idle teammate, while the sender's own routing metadata showed the
  correct sender. Acting on envelope identity alone can route questions, blame,
  or work to the wrong agent — or accept a fabricated confirmation of unverified
  work.
symptoms:
  - >-
    a hand-off or completion message attributed to an agent that disclaims the
    work
  - >-
    idle_notification events correctly labeled while a substantive message
    around the finish transition is mislabeled
  - >-
    send-side tool results show sender X but the recipient inbox shows
    teammate_id Y
solution: >-
  Never trust the teammate_id envelope for identity-sensitive decisions.
  Countermeasures adopted (2026-07-07): (1) hand-offs must embed the ticket key
  + latest commit SHA in the body so identity is verifiable from content against
  git; (2) verify any agent claim against repo ground truth (git log, file
  state) before acting; (3) when two agents give conflicting accounts,
  adjudicate with git evidence, not message metadata. Upstream: candidate Claude
  Code harness bug report (delivery-side mislabeling around the agent-finish
  transition).
tags:
  - multi-agent
  - harness
  - teammates
  - identity
  - process
projects:
  - hivemind
created_at: '2026-07-07T05:30:00.000Z'
last_seen_at: '2026-07-07T05:30:00.000Z'
source_tier: T1
---
Observed live 2026-07-07 during the goal-sweep2 drive: dev-101's full TASK-101 hand-off (verbatim red run, per-file breakdown) was delivered under dev-097's envelope minutes after dev-097 honestly disclaimed all TASK-101 knowledge. dev-101 confirmed both its sends showed sender:dev-101 in its own tool results. The recovery hinged on dev-097 refusing to vouch for work it never did — an agent less honest would have poisoned the close. Recorded in the session bundle grant_note and TASK-101's close comment.
