# Design: Hivemind Addon Packs (and the "Diseño Poderoso" design pack)

**Status:** Draft / design discussion — not yet scheduled as tickets.
**Date:** 2026-07-08
**Origin:** Discussion around integrating the "Diseño Poderoso" design-interview + resource-orchestration framework into Hivemind.

---

## 1. Motivation and reframe

The initial request was to integrate a design-focused framework ("Diseño Poderoso"): an adaptive interview that profiles a project, scores its complexity, and then **auto-activates/installs only the design resources it needs** (skills + MCP servers) in the right order, before generating anything.

The key realization during design: this is **not a design feature** — it is the first instance of a general pattern Hivemind will hit repeatedly ("we will face this in the future with other integrations"). So the real work is a **capability-pack system**, with the design framework as **pack #1**.

Guiding constraints from the discussion:

- **Anyone building software** is the consumer; design-heavy projects opt into the design pack.
- The deep-design capability must stay **separated, encapsulated, and non-default** — added to a project only when needed, so we don't bloat core and can **remove or replace** resources when they're no longer needed.
- Packs are **addons distributed via the Hivemind website** (a marketplace), installed per project on demand.

---

## 2. Architecture: declarative reconciler + lockfile

Because packs must **add, remove, and replace** resources without stepping on each other or on the user's own setup, the correct mental model is a **declarative reconciler with a lockfile** (Terraform/Nix/package-lock — not an install script).

Three pieces:

1. **Intent** — lives in `PROJECT.md`. Human-readable, versioned. Example: `design_heavy: yes`, `tier: COMPLETO`, plus the `perfil_proyecto` block. This is the *what I want*.
2. **Lock** — a committed manifest (working name `integrations.lock.json`). Records every **resolved resource**, its **origin + pinned version/commit**, which **pack owns it**, and its **scope** (project vs user). This is the *what is actually wired*.
3. **Reconciler** — computes `desired (tier → toolset) vs actual (probe the environment)` and then **installs missing, removes orphaned, replaces drifted**. Idempotent by construction — this satisfies both the idempotency and the removal requirements in one mechanism.

### 2.1 Ownership tracking is the whole ballgame for removal

"Remove old MCP if not needed" is only safe if the lockfile records that **a pack installed it**. The reconciler must **never** remove a resource just because the current toolset dropped it — the user or another pack may depend on it.

**Removal rule:** remove only if the lockfile says a pack owns it **AND** no other active pack references it. On ambiguity → **ask** (interactive) or **leave-and-report** (trust mode). Cross-pack reference-counting becomes mandatory the moment there is a pack #2.

### 2.2 Prefer project scope; user scope leaks

`claude mcp add -s user` registers globally across **every** project on the machine. If the pack installs a user-scoped MCP for this repo and later "removes" it, it can break unrelated projects — or orphan it forever. **Prefer project-scoped `.mcp.json` in the repo** for anything a pack owns, so removal is contained and the lockfile's blast radius matches reality. Any resource that *only* offers user scope is a flagged special case.

### 2.3 Hard vs soft prerequisites

The source spec's "if install fails, continue with a hole and report" is right for *optional* resources but wrong for *prerequisites*. Each resource carries `required: hard | soft`:

- **hard** failure → blocks the loop with a clear error (e.g. `frontend-design` on a design project).
- **soft** failure → degrade and report (e.g. Firecrawl research).

The setup phase gates on hard prereqs before handing off to the loop.

---

## 3. Execution sequence

```
profile (interview)                → perfil_proyecto + tier   (written to PROJECT.md)
   → resolve minimal toolset        → desired resource set
   → reconcile: install prereqs     → gated per trust boundary (§4)
   → [SESSION RESTART boundary]     → newly-installed MCP become loadable
   → start the loop                 → prereqs guaranteed present
```

**Why this shape:** installing everything up front and never toggling MCP mid-session **dissolves the runtime-MCP-toggling problem** — Claude Code cannot cleanly add/drop MCP live, so we never rely on it. The ≤3–5 MCP budget becomes a **resolution-time** concern (pick the minimal set), not a runtime one.

**The restart seam is real:** a freshly-registered MCP is not usable until the session reloads. So the honest flow is two sessions with a clean handoff via the state bundle: *setup session* (profile + install + write state) → **restart** → *loop session* (everything present). A pack cannot "install and immediately use" a new MCP in one breath.

---

## 4. Trust boundary (the "mix of autonomous and asking")

The design step carries its own trust toggle. The human either runs it **interactively** (asked at each gated action) or grants a standing **`design_pipeline` `loop_auth` scope** and lets the AI drive autonomously. This reuses Hivemind's existing `loop_auth` machinery — **not** a parallel one.

| Action | Interactive | Trust granted |
|---|---|---|
| Skill **selection** (tier → toolset) | autonomous | autonomous |
| Skill **activation** (already installed) | autonomous | autonomous |
| **Installing** a plugin/skill | **ask** | autonomous |
| Registering an **MCP** (`.mcp.json`, `mcp add`) | **ask** | autonomous |
| Writing **API keys / credentials** (Firebase, Firecrawl) | **ask** | **still ask** |
| Publishing / global irreversible ops | **ask** | **still ask** |
| **Assimilating a third-party skill** | **ask** | **still ask** |

**Invariant:** credentials and publish **never** go autonomous, even under trust — matching the source spec's own credential carve-out, extended so installs are gated too when trust is *not* granted.

**Assimilation never goes autonomous, under any trust grant (locked, TASK-122).** A skill's self-declared frontmatter `license` is decision support, not a safety assurance — it is self-reported by the skill's own author and trivially forgeable, and it says nothing about whether the skill's *instructions* try to exfiltrate secrets or run arbitrary commands. So `hivemind-assimilate-skill` (§7) always assembles a full approval package — license verdict, provenance (origin/pin/integrity), an automated content-security scan, and a security-reviewer subagent verdict — and **no third-party skill ever adopts without an explicit human sign-off**, license classification notwithstanding. `design_pipeline` trust never covers this action; it stays interactive-only in both columns above.

---

## 5. Non-default separation: a registration hook, not core edits

If a pack must edit core (`CLAUDE.md`, `orchestrator-routing`) to inject its pipeline step, it is **not** decoupled and pack #2 will collide. Core must expose a **registration hook**: "after profiling, run each active pack's setup and inject its declared pipeline steps." Packs register *into* that hook; they never patch core.

Because packs are distributed via the website (possibly by third parties), this hook is effectively a **public extension API**:

- It must be **stable and documented**.
- Packs declare a **compat version** against the hook API, so an old pack cannot silently break a newer Hivemind.

---

## 6. Distribution, provenance, and the marketplace

Packs are plugin bundles listed on the Hivemind website. That makes the pack itself the **supply-chain boundary**:

- Every resource pin in the lockfile carries **origin + commit/version**.
- An **allowlist of trusted origins** gates what a pack may install; "replace" means bumping to another *vetted* pin.
- The marketplace needs a **trust signal**: official/signed vs community packs.

---

## 7. Don't build a second loop; verification implications

- The autonomous design pipeline (under trust) runs through Hivemind's **existing** loop and its 5 hard-stop gates + budget stop. The `design_pipeline` grant is one more auth entry; pipeline steps are ordinary tickets/steps the existing driver executes. **No bespoke runner.**
- **Design output has no falsifiable gate** → the design step is inherently `uat-only`. Trust automates the *build*; a **human PASS** still confirms the *result* at the end.
- **The reconciler is `tdd`-tier** and is the risky code: desired/actual diff, ownership tracking, uninstall safety. "Removed a resource I didn't own" is a data-loss-class bug — failing tests first, per the CLAUDE.md rubric.
- **Cost ceiling:** design pipelines (research + asset gen + multi-MCP) are token-heavy; under trust+loop they must honor the loop's budget gate.
- **Skill assimilation is also `tdd`-tier and carries its own mandatory verification gate, independent of the reconciler's.** `hivemind-assimilate-skill` (a `src/assimilate.js` primitive; TASK-120/TASK-122) never runtime-installs a third-party skill — it copies the content in at author/vet time, so the license and content-security decisions have to happen there, not at reconcile time. License classification (permissive/copyleft/unknown) is decision **support only**, computed the same way every time regardless of `decision`, and it is never itself a write authority — a self-declared, forgeable frontmatter license must never be able to auto-adopt. Before any adoption, an automated risky-pattern scan (shell/exec, network/URL fetch, env/credential access, filesystem access outside the skill dir, obfuscated/base64 blobs) and a security-reviewer subagent verdict over the skill's actual instruction text (the prompt-injection risk a pattern scanner alone cannot catch) are assembled into one approval package alongside the license verdict and provenance. **No third-party skill ever auto-adopts on any of these signals** — only an explicit human sign-off (`decision: 'approve'`) writes anything, and a `suspicious` reviewer verdict blocks even that approve unless the human also passes an explicit override.

---

## 8. Pack descriptor schema (first cut)

A pack is **data** conforming to a descriptor schema. Design becomes one such file, which is what makes it removable, replaceable, and non-default. Illustrative shape (names provisional):

```jsonc
{
  "id": "design-power",
  "name": "Diseño Poderoso",
  "version": "0.1.0",
  "core_compat": ">=X.Y",              // §5 hook API version

  "trigger": {
    "intake_question": "Is this project design-heavy?",
    "activates_when": "answer == yes"
  },

  "project_md_contribution": ["perfil_proyecto", "tier"],  // §2 intent

  "profile": {                          // Fase 0-1 interview + Fase 2 scoring
    "base_questions": [ /* ... */ ],
    "conditional_rules": [ /* R1..R6 */ ],
    "complexity_fn": "score → LIGERO | MEDIO | COMPLETO"
  },

  "resources": [                        // §2.1/2.2/2.3
    {
      "id": "frontend-design",
      "kind": "plugin",
      "origin": "anthropic/frontend-design",
      "pin": "<commit-or-version>",
      "scope": "project",
      "required": "hard",
      "activate_when": "always",
      "install": "claude plugin add anthropic/frontend-design"
    }
    // ui-ux-pro-max (tier>=MEDIO), shadcn-vue (vue + ui_outside_canvas),
    // gsap (motion_required && motion_layer==dom), firecrawl (needs_research),
    // openart (COMPLETO && assets), playwright (COMPLETO && web UI) ...
  ],

  "gate_scopes": ["design_pipeline"],   // §4 loop_auth scope this pack introduces

  "pipeline": [                         // Fase 4 steps injected via the hook (§5)
    "reference", "research", "art-direction", "design-system",
    "implementation", "motion", "assets", "polish", "testing"
  ]
}
```

### 8.1 Design-pack specifics carried from the source spec

- **shadcn/ui is React-only** → route to **shadcn-vue** when `framework == vue` (same registry/MCP).
- **Phaser/canvas** projects: UI skills apply only to the **HTML/DOM layer** (HUD, menus, overlays), never the canvas render. When `ui_outside_canvas == false`, disable shadcn-vue, DOM polish, and DOM Playwright.
- **Exclusion rules** and the **maintenance note** (commands/prices drift fast) → the resource table is a **maintained manifest/KB entry read at runtime**, not hardcoded logic.

---

## 9. Open issues / to pressure-test next

1. **Restart-seam UX** — confirm the two-session (setup → restart → loop) flow is acceptable and design the handoff via the state bundle.
2. **Reconciler contract** — exact `integrations.lock.json` schema + the desired/actual probe (how do we reliably detect an installed skill/MCP?).
3. **Cross-pack reference-counting** — data model for shared resources once pack #2 exists.
4. **Hook API surface** — what exactly a pack may inject (pipeline steps, intake questions, PROJECT.md blocks, gate scopes) and how core enforces isolation.
5. **Marketplace trust model** — signing/vetting for website-distributed packs.
6. **UAT under trust** — the shape of the final human-PASS checkpoint for subjective design quality.

---

## 10. Source

Full source spec ("Documento de Diseño — Framework 'Diseño Poderoso'") captured in the originating discussion. This doc is the Hivemind-integration reframe of it; the source remains the reference for the interview questions, scoring formula, decision table, and command map.
