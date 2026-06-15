// tests/chat-ui-scaffold.spec.js
// TASK-052 — Fast-tier regression locks for the chat panel added to buildHtml().
//
// Strategy: pure string-grep over the served HTML (same pattern as the M3 /graph
// pins in tests/knowledge-graph-scaffold.spec.js and M2 in task-board-scaffold.spec.js).
// NO socket, NO process spawn — fast tier.
//
// Locks encode the TASK-052 acceptance criteria that are greppable:
//   1. Chat panel marker (id="chat-panel") is present in the served page.
//   2. EventSource is opened against /api/chat/ (the stream endpoint).
//   3. A fetch POST is made to the chat send endpoint with Content-Type application/json.
//   4. XSS discipline: within the chat script region, .innerHTML is never assigned
//      anything other than '' (if present at all); .textContent and/or
//      document.createElement are used for dynamic content.
//   5. Activity-chip branches: 'subagent' and 'tool' event types are handled
//      (locks the activity-chip feature from TASK-052 AC2).
//
// These are the MINIMAL locks per the tests-after new-test budget. No DOM-render
// specs are added (brittle, not in budget).

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';

const TASK_BOARD_SRC = join(REPO_ROOT, 'src', 'task-board.js');

// ---------------------------------------------------------------------------
// Helper: extract the FIRST HTML document from src/task-board.js (the board
// page returned by buildHtml()).  The board page is the first <!DOCTYPE html>
// block; the graph page is the second.  We operate on the full first block.
// ---------------------------------------------------------------------------
function boardHtmlSrc() {
  expect(existsSync(TASK_BOARD_SRC), 'src/task-board.js must exist').toBe(true);
  const src = readFileSync(TASK_BOARD_SRC, 'utf8');
  const start = src.indexOf('<!DOCTYPE html>');
  expect(start, 'src/task-board.js must embed at least one HTML document').toBeGreaterThan(-1);
  // End at the closing </html> of the FIRST document.
  const end = src.indexOf('</html>', start);
  expect(end, 'the first HTML document must be terminated with </html>').toBeGreaterThan(start);
  return src.slice(start, end + '</html>'.length);
}

// ---------------------------------------------------------------------------
// Helper: extract only the <script> section(s) that follow the board markup.
// We take everything from the first <script> tag to </script> in the first
// HTML document — this is where the chat JS lives.
// ---------------------------------------------------------------------------
function boardScriptSrc() {
  const html = boardHtmlSrc();
  const start = html.indexOf('<script>');
  expect(start, 'the board HTML must contain a <script> block').toBeGreaterThan(-1);
  return html.slice(start);
}

// ===========================================================================
// Lock 1 — Chat panel marker is present in the served board page.
// ===========================================================================
describe('TASK-052 — chat panel marker present in served board page', () => {
  it('served_page_contains_chat_panel_id', () => {
    const html = boardHtmlSrc();
    expect(
      html.includes('id="chat-panel"'),
      'the served board HTML must include an element with id="chat-panel"',
    ).toBe(true);
  });
});

// ===========================================================================
// Lock 2 — EventSource is opened against the /api/chat/ stream endpoint.
// ===========================================================================
describe('TASK-052 — EventSource usage pins the stream endpoint', () => {
  it('script_opens_EventSource', () => {
    const script = boardScriptSrc();
    expect(
      script.includes('new EventSource('),
      'the board script must open an EventSource (SSE stream)',
    ).toBe(true);
  });

  it('EventSource_references_api_chat_path', () => {
    const script = boardScriptSrc();
    expect(
      script.includes('/api/chat/'),
      'the EventSource URL must reference /api/chat/ (the orchestrator stream endpoint)',
    ).toBe(true);
  });
});

// ===========================================================================
// Lock 3 — fetch POST to the chat send endpoint with Content-Type JSON.
// ===========================================================================
describe('TASK-052 — fetch POST to chat endpoint with Content-Type application/json', () => {
  it('script_uses_fetch_to_post_to_chat_endpoint', () => {
    const script = boardScriptSrc();
    // Must use fetch() to post to /api/chat/
    expect(
      script.includes('fetch('),
      'the board script must use fetch() to send a user turn',
    ).toBe(true);
  });

  it('fetch_post_sets_content_type_application_json', () => {
    const script = boardScriptSrc();
    // Must set Content-Type: application/json for the POST body.
    expect(
      script.includes('Content-Type') && script.includes('application/json'),
      'the fetch POST must set Content-Type: application/json',
    ).toBe(true);
  });
});

// ===========================================================================
// Lock 4 — XSS discipline: within the chat script, .innerHTML is only ever
// assigned the empty-string clear (if assigned at all); .textContent and/or
// document.createElement are used for dynamic content.
// ===========================================================================
describe('TASK-052 — XSS discipline: innerHTML only empty-clear; textContent/createElement for content', () => {
  it('chat_script_innerHTML_assignments_are_only_empty_string_clear', () => {
    const script = boardScriptSrc();
    const assignments = script.match(/\.innerHTML\s*=\s*[^;\n]+/g) || [];
    for (const a of assignments) {
      expect(
        /\.innerHTML\s*=\s*(''|"")\s*$/.test(a),
        'innerHTML may only be assigned the empty-string clear in the board page, found: ' + a,
      ).toBe(true);
    }
  });

  it('chat_script_uses_textContent_for_dynamic_content', () => {
    const script = boardScriptSrc();
    expect(
      /\.textContent/.test(script),
      'the board script must use .textContent to set dynamic/untrusted content (XSS discipline)',
    ).toBe(true);
  });

  it('chat_script_uses_createElement_for_dom_building', () => {
    const script = boardScriptSrc();
    expect(
      /document\.createElement\(/.test(script),
      'the board script must use document.createElement() to build DOM nodes (XSS discipline)',
    ).toBe(true);
  });
});

// ===========================================================================
// Lock 5 — Activity-chip branches: 'subagent' and 'tool' event types handled.
// Locks the TASK-052 AC2 feature (distinct chips for tool/subagent events).
// ===========================================================================
describe('TASK-052 — activity-chip event type branches: subagent + tool', () => {
  it('script_handles_subagent_event_type', () => {
    const script = boardScriptSrc();
    expect(
      script.includes("'subagent'") || script.includes('"subagent"'),
      "the board script must handle the 'subagent' event type (activity chip)",
    ).toBe(true);
  });

  it('script_handles_tool_event_type', () => {
    const script = boardScriptSrc();
    expect(
      script.includes("'tool'") || script.includes('"tool"'),
      "the board script must handle the 'tool' event type (activity chip)",
    ).toBe(true);
  });
});
