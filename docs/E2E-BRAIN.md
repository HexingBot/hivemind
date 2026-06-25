# Live E2E — the brain seam

Validates the Phase 1 "Done when" against **real** infrastructure: *a research question populates
the cited graph and a ticket consumes it end-to-end; pulling the brain offline degrades gracefully.*

Everything in the test suite is unit-verified with fakes; this is the one check that needs Docker +
Voyage + a logged-in `claude`. Run it before merging the brain branches, or after touching the seam.

> **Result of the reference run (2026-06-24): `PASS=10 FAIL=0 SKIP=0`** — see "Expected output" below.

## Prerequisites

| Need | Why | Check |
|------|-----|-------|
| **Docker + compose** | runs Neo4j + Qdrant (the canonical graph) | `docker compose version` |
| **wisearcher repo + a venv** | the brain MCP server + its deps | `<wisearcher>/.venv/bin/python -c "import mcp, wisearcher.mcp_server"` |
| **`VOYAGE_API_KEY`** | embeddings (ingest + search) | `echo $VOYAGE_API_KEY` |
| **`claude` CLI, logged in** | grounded synthesis (`ask`, skill/lesson gen) — subscription auth, no API key | `claude --version` (run `claude login` once) |

## One-time setup — the venv (the common gotcha)

`bin/brain-launch.js` resolves the wisearcher repo as a sibling (`../wisearcher`), which is the
**git repo** `wisengine/wisearcher`. That repo needs its **own** `.venv` (there is a second, non-git
`code/wisearcher` copy that holds a separate venv but lacks the newer code — do not rely on it):

```bash
cd <path>/wisengine/wisearcher
uv venv
uv pip install -e ".[dev]" "mcp>=1.0"
# sanity:
.venv/bin/python -c "import mcp, wisearcher.mcp_server; print('ok')"
```

If you skip this, the smoke shows `spawn wisearcher-mcp ENOENT` and the brain falls back to grep.

## Run

```bash
cd <path>/wisengine/hivemind
npm run e2e:brain            # = bash scripts/brain-smoke.sh
#   --skip-docker            # DBs already up
#   --teardown               # docker compose down at the end
#   WISEARCHER_PATH=/abs/path # override sibling resolution
```

Steps whose prerequisites are missing are **SKIPPED** (reported), not failed — the graceful-fallback
check always runs. The script never edits your repo; it ingests into a throwaway `smoke-<pid>` topic.

## Expected output (reference run)

```
== 2. kb_health (via bin/brain-launch.js --health) ==
{"neo4j": true, "qdrant": true, "voyage": true, "ok": true}
  [PASS] neo4j + qdrant reachable

== 3. ingest --graph + ask (populate + consume the cited graph) ==
React Query caches server state. It is not for local UI state. [source: 9899787bd5d697d2 — ...]
Citations:
  - 9899787bd5d697d2: ...
  [PASS] research question answered from the cited graph

== 4. brain-client over MCP + graceful grep-fallback ==
     search source=brain hits=1
     offline search source=grep (expect "grep")
  [PASS] brain-client probe + offline fallback OK

== Summary ==
  PASS=10  FAIL=0  SKIP=0
```

What each step proves: **2** the brain is up and the launcher can exec the MCP; **3** the Phase 1
done-when (cited graph populated + consumed); **4** the hivemind brain-client gets a live `source=brain`
hit over MCP, *and* an offline read degrades to `source=grep`.

## Troubleshooting

- **`spawn wisearcher-mcp ENOENT`** → the resolved wisearcher repo has no `.venv`. Do the one-time
  setup above, or set `WISEARCHER_PATH` to a copy that has one.
- **`kb_health` times out / `Voyage API error … reduced rate limits of 3 RPM`** → the Voyage *free
  tier* is 3 requests/min, so the health-probe embed can time out when it competes with search
  embeds. It is transient (the search itself still returns `source=brain`); add a payment method on
  the Voyage dashboard or just re-run. Not a failure of the seam.
- **`ask` skipped / fails** → `claude` not installed or not logged in (`claude login`).
- **DBs not reachable** → `docker compose -f <wisearcher>/docker-compose.yml up -d`, wait a few
  seconds, retry.

## Teardown

```bash
npm run e2e:brain -- --teardown      # stops Neo4j + Qdrant
# the throwaway smoke-<pid> topic remains under wisearcher-data/topics/ — delete if you like
```
