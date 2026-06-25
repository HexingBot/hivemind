---
name: preview-canvas-fixture
preview_command: node tests/fixtures/preview-canvas/server.js
preview_mode: web
---

# Preview Canvas Fixture

Minimal canvas animation fixture for TASK-068 UAT.

A bouncing-ball requestAnimationFrame loop served as a static HTML page.
NO CDN, NO Phaser SDK, NO network — fully offline.

## Start command

Run from the hivemind repo root:

```
node tests/fixtures/preview-canvas/server.js
```

Or configure in the board's PROJECT.md:

```yaml
preview_command: node tests/fixtures/preview-canvas/server.js
preview_mode: web
```

The server prints `Listening on http://localhost:<port>` and the Preview panel
auto-detects the URL and renders the canvas animation in an iframe.
