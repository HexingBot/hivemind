#!/usr/bin/env bash
# brain-smoke.sh - live end-to-end smoke for the hivemind brain seam (Phase 1 "Done when":
# a research question populates the cited graph and a ticket consumes it; offline degrades
# gracefully). This is NOT a CI test - it needs Docker + VOYAGE_API_KEY + a logged-in `claude`
# CLI + a wisearch venv. See docs/E2E-BRAIN.md for setup. Steps whose prerequisites are
# missing are SKIPPED (reported), not failed - the graceful-fallback check always runs.
#
# Usage: bash scripts/brain-smoke.sh [--skip-docker] [--teardown]

set -uo pipefail

HM_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKIP_DOCKER=0; TEARDOWN=0
for a in "$@"; do case "$a" in
  --skip-docker) SKIP_DOCKER=1 ;;
  --teardown) TEARDOWN=1 ;;
  *) echo "unknown arg: $a"; exit 2 ;;
esac; done

PASS=0; FAIL=0; SKIP=0
say()  { printf '\n== %s ==\n' "$1"; }
ok()   { printf '  [PASS] %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  [FAIL] %s\n' "$1"; FAIL=$((FAIL+1)); }
skip() { printf '  [SKIP] %s\n' "$1"; SKIP=$((SKIP+1)); }
have() { command -v "$1" >/dev/null 2>&1; }

# --- resolve the wisearch repo the same way bin/brain-launch.js does ---
resolve_ws() {
  if [ -n "${WISEARCH_PATH:-}" ] && [ -f "$WISEARCH_PATH/wisearch/mcp_server.py" ]; then
    echo "$WISEARCH_PATH"; return 0; fi
  for c in "$HM_ROOT/../wisearch" "$HM_ROOT/../../wisearch"; do
    [ -f "$c/wisearch/mcp_server.py" ] && { (cd "$c" && pwd); return 0; }
  done
  return 1
}

say "Preflight"
WS="$(resolve_ws)" && ok "wisearch resolved: $WS" || { bad "wisearch repo not found (set WISEARCH_PATH)"; echo; echo "Cannot continue without wisearch."; exit 1; }
export WISEARCH_PATH="$WS"

PY=""
if [ -x "$WS/.venv/bin/python" ]; then PY="$WS/.venv/bin/python"; ok "wisearch venv present"; else skip "no $WS/.venv (see docs/E2E-BRAIN.md - create it with uv); python steps limited"; fi
have docker && docker compose version >/dev/null 2>&1 && ok "docker compose available" || skip "docker compose missing - brain DBs cannot start"
[ -n "${VOYAGE_API_KEY:-}" ] && ok "VOYAGE_API_KEY set" || skip "VOYAGE_API_KEY unset - ingest/search will degrade"
have claude && ok "claude CLI present (synthesis needs it logged in)" || skip "claude CLI missing - ask/skill-gen skipped"
if [ -n "$PY" ]; then "$PY" -c "import mcp" 2>/dev/null && ok "mcp installed in venv" || skip "mcp not in venv (uv pip install mcp)"; fi

# --- 1. bring up the brain stack ---
if [ "$SKIP_DOCKER" -eq 0 ] && have docker && [ -f "$WS/docker-compose.yml" ]; then
  say "1. docker compose up (Neo4j + Qdrant)"
  if docker compose -f "$WS/docker-compose.yml" up -d >/dev/null 2>&1; then ok "brain stack up"; sleep 4; else bad "docker compose up failed"; fi
else
  say "1. docker compose up"; skip "skipped (--skip-docker or docker/compose absent)"
fi

# --- 2. health probe via the launcher ---
say "2. kb_health (via bin/brain-launch.js --health)"
if [ -n "$PY" ]; then
  HEALTH="$(node "$HM_ROOT/bin/brain-launch.js" --health 2>/dev/null || true)"
  echo "  $HEALTH"
  echo "$HEALTH" | grep -q '"neo4j": *true' && echo "$HEALTH" | grep -q '"qdrant": *true' \
    && ok "neo4j + qdrant reachable" || skip "brain not fully healthy (check Docker / VOYAGE_API_KEY)"
else
  skip "no venv - cannot run the python health probe"
fi

# --- 3. populate the cited graph and consume it (wisearch CLI) ---
say "3. ingest --graph + ask (populate + consume the cited graph)"
if [ -n "$PY" ] && [ -n "${VOYAGE_API_KEY:-}" ] && have claude; then
  TOPIC="smoke-$$"
  FIX="$(mktemp).md"; printf '# React Query\nReact Query caches server state. It is not for local UI state.\n' > "$FIX"
  ( cd "$WS" && "$PY" -m wisearch.cli init-topic "$TOPIC" --mission "smoke" >/dev/null 2>&1 \
      && "$PY" -m wisearch.cli ingest "$TOPIC" "$FIX" --graph >/dev/null 2>&1 \
      && "$PY" -m wisearch.cli ask "$TOPIC" "what does React Query cache?" ) \
    && ok "research question answered from the cited graph" || bad "ingest/ask failed (see output above)"
  rm -f "$FIX"
else
  skip "needs venv + VOYAGE_API_KEY + claude login"
fi

# --- 4. hivemind brain-client over MCP + graceful fallback (always runs the fallback half) ---
say "4. brain-client over MCP + graceful grep-fallback"
CLAUDE_PROJECT_DIR="$HM_ROOT" node "$HM_ROOT/scripts/brain-smoke-client.mjs" "${TOPIC:-smoke}" \
  && ok "brain-client probe + offline fallback OK" || bad "brain-client probe failed"

# --- teardown ---
if [ "$TEARDOWN" -eq 1 ] && have docker && [ -f "$WS/docker-compose.yml" ]; then
  say "teardown"; docker compose -f "$WS/docker-compose.yml" down >/dev/null 2>&1 && ok "brain stack down"
fi

say "Summary"
printf '  PASS=%d  FAIL=%d  SKIP=%d\n' "$PASS" "$FAIL" "$SKIP"
[ "$FAIL" -eq 0 ] || exit 1
