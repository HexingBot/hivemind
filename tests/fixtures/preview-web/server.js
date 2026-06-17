// tests/fixtures/preview-web/server.js
// TASK-068 — Minimal web-page fixture for UAT: Preview panel.
//
// Start command (from repo root):
//   node tests/fixtures/preview-web/server.js
//
// Preview config (add to your board's PROJECT.md frontmatter):
//   preview_command: node tests/fixtures/preview-web/server.js
//   preview_mode: web
//
// This is an OFFLINE fixture — no network dependencies.  It serves a static
// HTML page from memory.  The server announces its URL on stdout in the format
// "Listening on http://localhost:<port>" which the preview-process URL detector
// matches automatically.
//
// UAT step: open the board console, click the Preview tab, click Start.
//   Expected: the iframe shows a "Hello from the web fixture" page.

import http from 'node:http';

const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Web Fixture</title>
  <style>
    body {
      font-family: sans-serif;
      background: #1a1a2e;
      color: #e0e0ff;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      flex-direction: column;
      gap: 12px;
    }
    h1 { font-size: 1.5rem; color: #58a6ff; }
    p  { font-size: 0.9rem; color: #8b949e; }
  </style>
</head>
<body>
  <h1>Hello from the web fixture</h1>
  <p>Served by tests/fixtures/preview-web/server.js — OFFLINE, no CDN.</p>
</body>
</html>`;

const server = http.createServer((_req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(PAGE),
  });
  res.end(PAGE);
});

const PORT = parseInt(process.env.PORT || '0', 10);

server.listen(PORT, '127.0.0.1', () => {
  const port = server.address().port;
  // This line is parsed by the URL detector in preview-process.js.
  process.stdout.write(`Listening on http://localhost:${port}\n`);
});

process.on('SIGTERM', () => { server.close(); process.exit(0); });
process.on('SIGINT',  () => { server.close(); process.exit(0); });
