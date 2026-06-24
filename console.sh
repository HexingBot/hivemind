#!/usr/bin/env sh
# Hivemind OS console launcher — run with: sh console.sh
# Starts the task board on port 4517 and opens your default browser.
# Requires Node.js 20+.  Press Ctrl+C in this window to stop the server.
node "$(dirname "$0")/dist/task-board.cjs" --open --port 4517
