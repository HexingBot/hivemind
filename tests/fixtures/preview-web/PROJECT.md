---
name: preview-web-fixture
preview_command: node tests/fixtures/preview-web/server.js
preview_mode: web
---

# Preview Web Fixture

Minimal web app fixture for TASK-068 UAT.

## Start command

Run from the agentic-framework repo root:

```
node tests/fixtures/preview-web/server.js
```

Or configure in the board's PROJECT.md:

```yaml
preview_command: node tests/fixtures/preview-web/server.js
preview_mode: web
```

The server prints `Listening on http://localhost:<port>` and the Preview panel
auto-detects the URL and shows the page in an iframe.
