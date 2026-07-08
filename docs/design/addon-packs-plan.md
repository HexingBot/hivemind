# Implementation Strategy: Addon Packs (v1)

**Status:** Strategy / proposed ticket breakdown — awaiting go-ahead.
**Date:** 2026-07-08
**Companion to:** `docs/design/addon-packs.md` (architecture). This doc turns that into a phased, grounded build plan backed by three research sweeps (Claude Code mechanics, Hivemind extension points, reconciler patterns).

---

## 1. The finding that shapes everything

Claude Code's three resource kinds are **not equally scriptable**:

- **MCP servers** — fully scriptable: `claude mcp add/remove/list`, non-interactive. **stdio MCP needs a session restart** before its tools load; http MCP loads immediately. Project-scope `.mcp.json` triggers a **pending-approval trust dialog** on first use (a human gate we don't control).
- **Skills** — fully scriptable: they're just `SKILL.md` files; detect by glob, install by write, remove by `rm`. Live discovery, no restart.
- **Plugins** — **not cleanly scriptable**: no shell `list`, install/uninstall is TUI-only. Only workaround is editing `.claude/settings.json` `enabledPlugins` directly + running `/reload-plugins` inside a session.

**Consequence:** the v1 autonomous reconciler targets **skills + MCP only**. Third-party *plugins* are handled as a **gated special case** (write settings + tell the human to `/reload-plugins`), never silent autonomous install. This keeps v1 fully within scriptable surface and defers the messy part.

The confirmed non-scriptable seams (stdio restart, project-MCP approval dialog, plugin reload) all land on the **setup → [human touchpoint] → loop** boundary the architecture already anticipated — so they cost us nothing new architecturally.

---

## 2. Lockfile + reconciler contract (from research)

`integrations.lock.json` entry (ownership as **edges**, not counters — Nix reachability model):

```jsonc
"<resource-id>": {                     // "mcp:firecrawl", "skill:shadcn-vue"
  "kind": "mcp | skill | plugin",
  "origin": "vendor/repo-or-registry",
  "pin": "commit-sha | semver-exact",  // exact, never a range
  "integrity": "sha256:<hex>",         // content hash of what was installed
  "scope": "project | user",
  "owners": ["design-power@0.1.0"],    // pack edges; empty ⇒ safe to remove
  "required": "hard | soft",
  "installed_at": "ISO-8601",
  "install_method": "claude mcp add ...",
  "verified": "signed | unsigned | unknown"
}
```

Reconcile = `desired (tier→toolset) vs actual (probe) → install / remove / replace / report`. **Removal rule:** an owner may only drop its own edge; remove the resource only when `owners` is empty AND (soft, or trust-mode). **Partial-apply = leave-and-report, never rollback** (Terraform model); a **hard** prereq failure aborts and blocks the loop.

Supply-chain v1: integrity hash verified before install, origin allowlist for pack authors, pin-by-SHA, credentials/publish never auto-approved, real signing deferred to v2 (the `verified` field is a v2-ready placeholder).

---

## 3. Grounded insertion points (Hivemind repo)

| Concern | Where | Template to copy |
|---|---|---|
| "design-heavy?" intake question | `src/question-library.js` `COMMON_QUESTIONS` (~:130) + normalizer in `bin/init.js` (~:463) | the `agent_models` optional question (`:110-129`) |
| `perfil_proyecto`/`tier` frontmatter | `src/project-md.js` (`SPECIAL_FRONTMATTER_IDS:93`, render `:208`, parse `:498`, restore `:385`) + `state/PROJECT.schema.json` | `agent_models` special-inline-object handling |
| Surgical file patching | `bin/init.js:702` `--apply-*` branch | `patchAgentModelContent` (`src/agent-generator.js:363-398`) |
| New `loop_auth` scope (`pack_install`) | `src/loop-auth.js:22` `LOOP_AUTH_SWITCHES` + `state/bundle.schema.json:93` | existing switches + `UNATTENDED_PRESET` |
| Install/close gating | guard modeled on `src/close-guard.js:103-133` | `loopModeCloseGuard` |
| Reconciler as MCP tool (optional) | `src/mcp-server.js` factory + `scripts/build-plugin.mjs:74/:49` + `.mcp.json` | `hivemind-tasks` server |
| Ticket shape | `tasks/schema.json` (`verification_tier`, `depends_on`, falsifiable `acceptance_criteria`) | — |
| Atomic writes for lockfile | `src/atomic-write.js:33` `atomicWriteFile` | — |

---

## 4. Phased roadmap

Build the **reusable machinery first**, prove it with a trivial pack, then layer the design-specific interview + pipeline. This directly serves the goal ("we'll face this with other integrations") — integration #2 should be nearly free.

**Phase A — Contracts (tdd).** Pack-descriptor JSON schema + validator; `integrations.lock.json` schema + atomic read/write. Pure data + validation, no behavior.

**Phase B — Reconciler core (tdd, the risky code).** Probe (MCP via `claude mcp list` parse; skills via glob); desired-vs-actual diff → plan; ownership edges + safe-removal; apply (MCP CLI, skills fs); leave-and-report + hard/soft. Plugins = settings-write path stubbed/flagged, not autonomous.

**Phase C — Trust + gate integration (tdd).** Generalized `pack_install` `loop_auth` switch; install-action gate (credentials/publish never auto) reusing the close-guard pattern; slot into the 5-gate contract.

**Phase D — Registration hook / extension API (tdd + docs).** Core hook: "after profiling, run active packs' setup + inject their pipeline steps." Stable, documented, versioned (`core_compat`). This is what keeps packs from patching core.

**Phase E — Profile subsystem (tdd).** "design-heavy?" intake question; conditional interview (Fase 0–1); pure complexity-scoring fn (Fase 2 → LIGERO/MEDIO/COMPLETO); `perfil_proyecto`/`tier` written to PROJECT.md.

**Phase F — The `design-power` pack (data + uat).** Author the descriptor: resources with pins/origins/scope/required, exclusion rules (canvas, shadcn-vue routing), pipeline steps. Mostly data conforming to Phase A's schema.

**Phase G — Marketplace/distribution (later).** `marketplace.json`, website listing, origin allowlist, official-vs-community trust signal.

**Recommended first vertical slice: Phases A + B + a minimal D**, proven end-to-end with a throwaway "hello-pack" that installs one skill + one http-MCP and cleanly removes them. That delivers the reusable core and de-risks the ownership/removal logic before any design-specific work.

---

## 5. Proposed first-wave tickets

(Numbers assigned at creation; tiers per the rubric.)

1. **Pack-descriptor schema + validator** — `tdd`. Schema file + `validatePackDescriptor()`; rejects unknown origins/kinds; round-trips a sample `design-power` descriptor. Dep: none.
2. **`integrations.lock.json` schema + atomic store** — `tdd`. Schema + read/write via `atomicWriteFile`; ownership-edge helpers (`addOwner`/`dropOwner`/`isOrphaned`). Dep: none.
3. **Environment probe** — `tests-after`. `probeActual()`: MCP from `claude mcp list`, skills from glob. Returns normalized actual-state map. Dep: 2. (Narrow follow-up on the exact `claude mcp list` output format flagged by research.)
4. **Reconcile planner (pure)** — `tdd`. `plan(desired, lock, actual) → {install, remove, replace, report}` with ownership/hard-soft rules. No I/O. Dep: 1, 2.
5. **Reconcile applier** — `tdd`. Executes a plan for skills (fs) + MCP (CLI); leave-and-report; hard-failure abort; commits lock atomically. Dep: 3, 4.
6. **`hello-pack` E2E harness** — `tests-after` (e2e). Installs 1 skill + 1 http-MCP, verifies lock + presence, removes, verifies orphan cleanup. Proves the slice. Dep: 5.

Phases C–G become subsequent waves once the core is green.

---

## 6. Open items still to resolve

- Exact `claude mcp list` machine-readable output (JSON?) for the probe — narrow follow-up before ticket 3.
- Whether the reconciler ships as a plain `src/` module or also as an MCP tool (lean: plain module first; MCP wrapper only if the orchestrator needs to call it as a tool).
- Plugin-path autonomy in a later wave (settings-edit + `/reload-plugins`) — explicitly out of v1.

---

## 7. Evolution: assimilation over runtime third-party install

**Key strategy change (2026-07-08).** Skills are just files, so there is no reason to *runtime-install* third-party skills and inherit their supply-chain and availability risk. Instead we **assimilate** them: a `hivemind-assimilate-skill` workflow that, at author/vet time (human-gated):

1. Fetches an external skill (repo/URL/path) and **shows the human its source** for review.
2. **Vets** it: origin against the allowlist, a scan for risky patterns, and — new — **license detection** (see below).
3. Writes the owned copy to the staging dir `assimilated-skills/<resource-id>/` (dir name == the bare resource id), **re-scoping the frontmatter** (description tagged for Hivemind) and appending a **`## Sources & provenance (hivemind)`** section: source origin, pinned commit SHA, SPDX license, `sha256` integrity, `assimilated_at`. The reconcile **applier** later materializes this owned copy into the live `.claude/skills/<resource-id>/` (two-stage model: assimilate = own+vet; applier = activate). *(Implemented this way in TASK-119/120; the earlier single-stage wording was corrected after the TASK-120 review.)*
4. Records it in `integrations.lock.json` with an `owners` edge and `verified` tier.

This is exactly the pattern the existing **vendored Spine skills** (`skills/impl-*/SKILL.md`) already follow by hand — assimilation just makes it a repeatable, provenance-recording workflow.

**Why this de-risks the whole design:** the trust/vetting decision moves to **assimilation time, human-gated** — which is precisely where VS Code's marketplace lesson says trust must live (publish/vet time, not install time). The **runtime third-party surface shrinks to MCP servers only** (processes we can't vendor as files). Assimilated skills are *owned copies*: an upstream repo going away, changing, or turning malicious after assimilation has **zero runtime effect**.

**Reconciler impact:** for skills, the "install missing" op becomes "**materialize our owned copy**" (local, no network); "remove orphaned" = delete the scoped copy + drop the owner edge. Far lower risk than an internet fetch during a loop.

**New risk this introduces — licensing.** Copying third-party skill text means honoring its license. The assimilate gate must detect + record the license and apply an allowlist: permissive (MIT / Apache-2.0 / BSD / ISC / CC0 / Unlicense) → auto-OK; copyleft (GPL family) or missing/ambiguous → **flag and require an explicit human decision**, never silent. SPDX id is stored in the provenance block.

## 8. Graceful-degradation policy (third-party failure)

Principle: **a soft failure never halts the pipeline; it records a gap the final report surfaces for the human. Hard prerequisites gate the loop before it starts.** Each pack resource declares `required: hard | soft` and an optional `fallback: <resource-id>`.

| Failure mode | Assimilated skill | MCP server |
|---|---|---|
| Origin unreachable / source gone | **No effect** — we own the copy; flagged only at next re-vet | soft → skip step + report gap; hard → block loop with actionable error |
| Install / registration fails | leave-and-report; hard aborts, soft degrades | same |
| Won't start (stdio spawn fail / health ✘) | n/a | treat as soft-unavailable for its step; use `fallback` if declared, else skip + report |
| Upstream changed/compromised after adoption | **No runtime effect** (owned copy); diff surfaced at re-vet | pin mitigates; integrity re-checked before use |

## 9. Reconciler env-probe — DE-RISKED

- `claude mcp list` has **no `--json`** (v2.1.204); output is health-check text. → The probe reads **config files directly**: `.mcp.json` (project) and `~/.claude.json` (user + per-project local) — deterministic JSON — for authoritative *registered* state. `claude mcp list` text is parsed only as a **soft liveness** signal, never as source of truth.
- Skills probe = glob `**/SKILL.md` (assimilated copies live under `.claude/skills/`).
- Observed precedence artifact: the repo's own `.mcp.json` `hivemind-tasks` entry fails env-var expansion while the plugin-provided copy connects — confirms multi-scope precedence and that config-file parsing (not CLI text) is the reliable probe.

## 10. Risk register (living)

| Subject | Status | What closes it |
|---|---|---|
| Reconciler env-probe | **CLOSED** | read config JSON, not CLI text (§9) |
| Skill 3rd-party supply chain | **CLOSED by design** | assimilation moves trust to author-time human gate (§7) |
| Ownership / safe removal (data-loss class) | **Design closed** | `owners`-edge model + tdd; applier still to build |
| Assimilation licensing | **CLOSED** | detection chain + allowlist finalized (§12) |
| Graceful degradation | **Drafted (§8)** | encode as testable policy + `required`/`fallback` fields in descriptor |
| MCP runtime dependency: restart + project-scope approval dialog | **CLOSED (Wave 2)** | handoff state machine specced (§13) |
| MCP integrity/pinning | **CLOSED (Wave 2)** | exact-pin + entry-file hash; honest limits documented (§13) |

## 11. Revised first-wave tickets (superseding §5)

Foundations unchanged (descriptor schema, lockfile+ownership, planner). Changes:

- **Replace** the synthetic `hello-pack` (old #6) with **`hivemind-assimilate-skill`** — assimilate one real permissive-licensed skill end-to-end (fetch → vet+license → scope+provenance → lockfile), then reconcile it in and cleanly remove it. This proves the slice on the *actual* v1 primitive.
- **Add** license-detection to the assimilate ticket's acceptance criteria.
- **Defer** any MCP *applier* work until the two open MCP risks (restart handoff, integrity/pinning) are closed — so the first wave is **skills/assimilation-only**, which is fully de-risked.

Blocked-until-closed (do not schedule yet): MCP applier, plugin path, marketplace.

---

## 12. License-detection spec (Wave 1 — assimilate gate)

**Detection fallback chain** (stop at first hit; record `detected_via`):
1. `SPDX-License-Identifier:` header in the skill's own files (wins even over a repo-wide license — a vendored file can carry its own).
2. `LICENSE`/`COPYING`/`LICENSE.md` at the **skill subdirectory** first, then repo root (nearest-enclosing wins).
3. GitHub Licenses API `GET /repos/{owner}/{repo}/license` (repo-hosted sources). Treat `404`/`"other"`/`"noassertion"` as *no signal*, not a match.
4. `license` field in nearest `package.json`.
5. "License" section in `README.md`.
6. **None found → `unknown` → human gate.** Bare copyright with no grant = all-rights-reserved (never assume permissive).

**Normalization:** hand-rolled `classifyLicense()` + `normalizeLicenseString()` table, **zero new deps** for v1 (the closed ~20-id set doesn't justify a lib; the esbuild `dist-parity` gate rewards minimal deps). Add `spdx-expression-parse` later *only* if compound expressions (`MIT OR Apache-2.0`) show up in practice. Skip `detect-license`/`license-checker` (they audit `node_modules`, a different problem).

**Permissive allowlist (auto-OK):** `MIT`, `Apache-2.0`, `BSD-2-Clause`, `BSD-3-Clause`, `ISC`, `CC0-1.0`, `Unlicense`, `0BSD`.
**Copyleft gate (→ human):** GPL / AGPL / LGPL families — both `-only`/`-or-later` forms **and** their deprecated pre-3.0-list aliases (`GPL-2.0`, `GPL-3.0`, …). Everything else (MPL, EPL, `LicenseRef-*`, custom, none) → gate. This is an allowlist for permissive, not a denylist for copyleft.

**Edge cases:** `OR` → permissive if *any* disjunct permissive; `AND` → permissive only if *all* conjuncts permissive. File-content signals (1–2) beat metadata (3–5) on conflict; mutual disagreement → `ambiguous` → gate. **Always** record `spdx_id` (or `null`), `detected_via`, `source_path`, `checked_at` in the provenance block — even on the auto-OK path.

**Open (non-blocking):** whether the assimilate workflow has a GitHub token (affects step-3 rate limit: 60/hr unauth vs authenticated).

## 13. MCP install handoff + pinning (Wave 2 — no schema migration)

**State machine** lives in `loop_state.pending_mcp_install` (the bundle's `loop_state` is `additionalProperties:true` — no schema change). Phases: `plan_resolved → registering → awaiting_restart (stdio only) → awaiting_approval → verifying → verified`.

- **Register** project-scoped (`claude mcp add --scope project`), one at a time, checkpoint before each; confirm by **re-reading `.mcp.json`**, never by CLI exit code.
- **awaiting_restart** (only if any stdio resource): call `pauseSession()` with a `handoffSummary`/`nextAction` naming the pending server + restart instruction; mirror into `blockers` and `pending_human_confirmation`. The **RESUME-FIRST contract already re-surfaces this** to the fresh session — no new mechanism. HTTP servers skip this phase.
- **awaiting_approval** (project-scope `⏸ Pending approval`): a **Claude-Code-UI-owned** action. Model it like **Gate 3 — non-liftable by any `loop_auth` switch.** A new `pack_install` switch may authorize *registration* only, never restart/approval.
- **verifying:** config-file read = source of truth; `claude mcp list` text = soft liveness (no `--json` in v2.1.204). Clear `pending_human_confirmation` only when *all* resources `verified`. Under loop mode, entering restart/approval writes a stop-reason, flips to `harness`, releases the lock (a loop can't span a CLI restart by construction).
- **Prefer HTTP transport**; choose stdio only when no HTTP endpoint exists.

**Pinning/integrity v1 (combine two cheap signals):** (1) exact version pin in descriptor+lock (never a range/dist-tag); (2) after first successful spawn, hash the resolved entry file into the lock's `integrity` (`sha256:…`), `verified:"unsigned"`; re-hash every reconcile — mismatch = **hard stop** via the same `pending_human_confirmation`/`blockers` channel. Reserve npm `package-lock` full-graph integrity for the case Hivemind *bundles the MCP first-party* (the `hivemind-tasks` pattern). No vendoring in v1. **Honest limits:** hashing proves "same bytes as approved," not "safe"; transitive deps stay unpinned; `unsigned` is a label, not a guarantee — trust still lives at pin/vet time.

**Open (non-blocking, pre-Wave-2 spot-checks):** does `claude mcp add` stdout distinguish "added" vs "added+pending"? Is there any scriptable "approve pending server" signal that could later reduce the approval gate to a documented recipe?
