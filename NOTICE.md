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
