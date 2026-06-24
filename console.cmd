@echo off
REM Hivemind OS console launcher — double-click to start the web console.
REM Starts the task board on port 4517 and opens your default browser.
REM Requires Node.js 20+.  Press Ctrl+C in this window to stop the server.
node "%~dp0dist\task-board.cjs" --open --port 4517
