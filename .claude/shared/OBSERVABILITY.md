# Observability Standard

## Scope

This standard governs **code the framework generates for target projects** — the manifest
and code-writer flow described under "Enforcement" below (`SCREEN_SPECS.md`, `BLOCK_TASKS.md`,
`code-writer`, `code-reviewer`). It does **not** govern the hivemind framework's own repo:
this repo carries zero OpenTelemetry dependencies or instrumentation, and its own observability
convention is **structured JSON result envelopes + typed errors with codes** (e.g. `{ ok: false,
error }` returns and `Error` subclasses that set `this.code`, as used throughout `src/`). A
reviewer auditing a diff to this repo's own `src/`, `bin/`, or `agents/` should not raise an
OTel-span/log finding against it — only diffs that touch the generated-target-project flow
(the `impl-*` skills, `code-writer`, `code-reviewer`) are in scope for the OTel requirements
below.

**Instrument with OpenTelemetry (vendor-neutral). Export to SigNoz (the backend decision —
recorded as a project decision, like any ADR stack choice).** Because instrumentation is
OTel, manifests stay language-agnostic: they say "trace span" / "structured log" / "metric",
and only the exporter/backend names SigNoz.

## What every functionality emits

| Signal | Where | Notes |
|--------|-------|-------|
| **Trace span** | **Every functionality** (user action, API call, task, integration) | One span per logical operation; child spans for sub-steps. So everything is observable. |
| **Structured log** | **Every functionality** | JSON; carries `trace_id` + `span_id` for correlation. Errors log the exception and record it on the span. |
| **Metric** | **Key paths only** (API calls, integrations, critical user flows) | Latency histogram + error/throughput counter. Gated to control cardinality/cost — not on every internal function. |

So "observability on every single functionality" = **every functionality is traced and
logged**; metrics are reserved for paths worth measuring.

## Conventions

- Follow OpenTelemetry **semantic conventions** for span/attribute/metric names.
- Span name = the operation (`campaign.apply`, `auth.login`), not the function name.
- Attributes carry traceability: scope item (`S-##`), block (`B-##`) where meaningful.
- **No PII / secrets** in span attributes, logs, or metric labels.
- Error paths: `span.record_exception` + set error status + a structured error log.

## Enforcement

**Manifest level**
- `SCREEN_SPECS.md`: each user action names the span it produces; the **Error** state notes
  that the failure is traced + logged.
- `BLOCK_TASKS.md`: acceptance criteria include the observability requirement
  ("emits span `<name>`; errors logged; latency metric on the API call").

**Code level (Phase 2)**
- `code-writer` wraps each functionality in a span, adds the correlated log, and a metric on
  key paths.
- `code-reviewer` **BLOCKER** for any functionality with no span/log; missing metric on a
  key path is a **SHOULD**.
