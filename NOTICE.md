# hivemind — provenance & attribution

**hivemind** is a derivative of **agent-framework** by Rafael Matovelle
(<https://github.com/lordiwa/agent-framework>), used under the MIT License. The
original license is preserved in [`LICENSE`](./LICENSE), and the upstream remote
(`upstream` → `lordiwa/agent-framework`) is kept so improvements can be pulled in.

hivemind extends that base — the **execution body** — into a single unified agentic
development framework by integrating two more tools:

- **wisengine** — the *spine*: epistemic discipline (calibrated markers + source
  tiering), language-agnostic specs/manifests, observability and minimalism standards.
  Vendored in as skills + validators. `proposal-engine` remains a **standalone** app.
- **wisearcher** — the *brain*: a deep-research knowledge engine (Neo4j + Qdrant,
  provenance-mandatory) that produces a cited knowledge graph and generates skills +
  lessons. Called as an out-of-process MCP service (managed, with graceful fallback).

See [`PLAN.md`](./PLAN.md) for the merge plan.

## Vendored third-party skills

The **Diseño Poderoso** design-power pack vendors third-party Agent Skills via the
`assimilate` gate (mandatory license classification + content security review +
explicit human sign-off). Each adoption's exact provenance — origin, pinned commit,
and `sha256` integrity — is recorded in [`integrations.lock.json`](./integrations.lock.json).

- **ui-ux-pro-max** — UI/UX design-intelligence skill by *nextlevelbuilder*
  (<https://github.com/nextlevelbuilder/ui-ux-pro-max-skill>), used under the MIT
  License. Vendored at commit `12b486b22e67f5d887962ef8351c1ac863bfaeb9` under
  `assimilated-skills/ui-ux-pro-max/` (staging) and materialized to
  `.claude/skills/ui-ux-pro-max/` (harness-loadable) by the pack reconciler.
