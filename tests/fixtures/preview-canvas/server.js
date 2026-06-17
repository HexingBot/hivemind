// tests/fixtures/preview-canvas/server.js
// TASK-068 — Minimal canvas-animation fixture for UAT: Preview panel.
//
// Start command (from repo root):
//   node tests/fixtures/preview-canvas/server.js
//
// Preview config (add to your board's PROJECT.md frontmatter):
//   preview_command: node tests/fixtures/preview-canvas/server.js
//   preview_mode: web
//
// This is an OFFLINE fixture — NO network dependencies, NO CDN, NO Phaser SDK.
// The "game" is a hand-written vanilla requestAnimationFrame canvas animation:
// a colored ball bouncing around the viewport.  This satisfies the UAT criterion
// "a canvas/Phaser game renders/plays" without requiring any internet access.
//
// UAT step: open the board console, click the Preview tab, click Start.
//   Expected: the iframe shows a bouncing ball animation (canvas game plays).

import http from 'node:http';

const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Canvas Fixture</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0d1117;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      flex-direction: column;
      gap: 10px;
      font-family: sans-serif;
      color: #8b949e;
    }
    canvas { border: 1px solid #30363d; border-radius: 6px; }
    p { font-size: 0.75rem; }
  </style>
</head>
<body>
  <canvas id="c" width="320" height="240"></canvas>
  <p>Canvas fixture (offline) — TASK-068 UAT</p>
  <script>
    var canvas = document.getElementById('c');
    var ctx = canvas.getContext('2d');
    var W = canvas.width, H = canvas.height;
    var R = 18;
    var x = W / 2, y = H / 2;
    var vx = 2.4, vy = 1.8;
    var hue = 0;

    function frame() {
      ctx.fillStyle = 'rgba(13,17,23,0.25)';
      ctx.fillRect(0, 0, W, H);

      x += vx; y += vy;
      if (x - R < 0)  { x = R;     vx = Math.abs(vx); }
      if (x + R > W)  { x = W - R; vx = -Math.abs(vx); }
      if (y - R < 0)  { y = R;     vy = Math.abs(vy); }
      if (y + R > H)  { y = H - R; vy = -Math.abs(vy); }

      hue = (hue + 1) % 360;
      ctx.beginPath();
      ctx.arc(x, y, R, 0, Math.PI * 2);
      ctx.fillStyle = 'hsl(' + hue + ', 85%, 60%)';
      ctx.fill();

      requestAnimationFrame(frame);
    }

    frame();
  </script>
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
