# Observability Standard

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
