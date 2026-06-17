// tests/validate-localhost-url.spec.js
// TASK-068 — Unit regression lock for validateLocalhostUrl (XSS bypass matrix).
//
// This spec imports the EXPORTED validateLocalhostUrl from src/task-board.js
// (single source of truth — the browser runs the exact same function body,
// injected into the <script> block via .toString() in buildHtml()).
//
// Every case in this matrix encodes a real attack vector or acceptance criterion.
// The test FAILS if the guard regresses — i.e. starts accepting an attack URL
// or rejecting a legitimate localhost URL.
//
// Origin-based validation (fix(TASK-068)): path/query/fragment are allowed so
// configured preview_url values like http://localhost:3000/ and
// http://localhost:3000/app work correctly. The XSS guard is carried by the
// origin checks: protocol, hostname, port, and absence of userinfo.
//
// Fast tier (pure logic, no disk I/O) — tests/*.spec.js.

import { describe, it, expect } from 'vitest';
import { validateLocalhostUrl } from '../src/task-board.js';

describe('validateLocalhostUrl — accept matrix (AC2 XSS guard)', () => {
  // Origin-only (no path) — auto-detected URL from preview-process stdout
  it('accepts http://localhost:3000', () => {
    expect(validateLocalhostUrl('http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('accepts http://127.0.0.1:56473', () => {
    expect(validateLocalhostUrl('http://127.0.0.1:56473')).toBe('http://127.0.0.1:56473');
  });

  it('accepts http://localhost:1', () => {
    expect(validateLocalhostUrl('http://localhost:1')).toBe('http://localhost:1');
  });

  it('accepts http://127.0.0.1:65535', () => {
    expect(validateLocalhostUrl('http://127.0.0.1:65535')).toBe('http://127.0.0.1:65535');
  });

  // With trailing slash — common configured preview_url form (regression from 4057f9e)
  it('accepts http://localhost:3000/ (trailing slash)', () => {
    expect(validateLocalhostUrl('http://localhost:3000/')).toBe('http://localhost:3000/');
  });

  // With path — natural configured preview_url form (TASK-069 documented)
  it('accepts http://localhost:3000/app (path)', () => {
    expect(validateLocalhostUrl('http://localhost:3000/app')).toBe('http://localhost:3000/app');
  });

  // With query string
  it('accepts http://localhost:3000/app?x=1 (path + query)', () => {
    expect(validateLocalhostUrl('http://localhost:3000/app?x=1')).toBe('http://localhost:3000/app?x=1');
  });

  // 127.0.0.1 with path — regression lock
  it('accepts http://127.0.0.1:5173/index.html (127.0.0.1 with path)', () => {
    expect(validateLocalhostUrl('http://127.0.0.1:5173/index.html')).toBe('http://127.0.0.1:5173/index.html');
  });
});

describe('validateLocalhostUrl — reject matrix (XSS attack bypass attempts)', () => {
  // Protocol attacks
  it('rejects javascript:alert(1)', () => {
    expect(validateLocalhostUrl('javascript:alert(1)')).toBeNull();
  });

  it('rejects data:text/html,<h1>xss</h1>', () => {
    expect(validateLocalhostUrl('data:text/html,<h1>xss</h1>')).toBeNull();
  });

  it('rejects https://localhost:3000 (wrong protocol)', () => {
    expect(validateLocalhostUrl('https://localhost:3000')).toBeNull();
  });

  // External host attacks
  it('rejects http://evil.com', () => {
    expect(validateLocalhostUrl('http://evil.com')).toBeNull();
  });

  it('rejects http://evil.com:3000', () => {
    expect(validateLocalhostUrl('http://evil.com:3000')).toBeNull();
  });

  it('rejects http://localhost.evil.com (hostname suffix bypass)', () => {
    expect(validateLocalhostUrl('http://localhost.evil.com')).toBeNull();
  });

  it('rejects http://localhost.evil.com:3000', () => {
    expect(validateLocalhostUrl('http://localhost.evil.com:3000')).toBeNull();
  });

  // Userinfo / credential injection attacks
  it('rejects http://127.0.0.1@evil.com (userinfo bypass)', () => {
    expect(validateLocalhostUrl('http://127.0.0.1@evil.com')).toBeNull();
  });

  it('rejects http://user:pass@localhost:3000 (credential injection)', () => {
    expect(validateLocalhostUrl('http://user:pass@localhost:3000')).toBeNull();
  });

  it('rejects http://localhost:3000@evil.com (authority confusion)', () => {
    expect(validateLocalhostUrl('http://localhost:3000@evil.com')).toBeNull();
  });

  // Port suffix / path attacks
  it('rejects http://localhost:3000.evil.com (port+hostname splice)', () => {
    expect(validateLocalhostUrl('http://localhost:3000.evil.com')).toBeNull();
  });

  // Missing port
  it('rejects http://localhost (no port)', () => {
    expect(validateLocalhostUrl('http://localhost')).toBeNull();
  });

  it('rejects http://127.0.0.1 (no port)', () => {
    expect(validateLocalhostUrl('http://127.0.0.1')).toBeNull();
  });

  // IPv6 (not in the accepted set — preview-process only emits IPv4 localhost URLs)
  it('rejects http://[::1]:3000 (IPv6 not in accepted set)', () => {
    expect(validateLocalhostUrl('http://[::1]:3000')).toBeNull();
  });

  // Hex/octal IP encoding bypasses
  it('rejects http://0x7f000001:3000 (hex IP encoding)', () => {
    expect(validateLocalhostUrl('http://0x7f000001:3000')).toBeNull();
  });

  // Port out of valid range (port > 65535 — URL spec treats it as invalid)
  it('rejects http://localhost:65536 (port out of range)', () => {
    expect(validateLocalhostUrl('http://localhost:65536')).toBeNull();
  });

  // Whitespace / casing inputs
  it('rejects "  http://localhost:3000" (leading whitespace)', () => {
    expect(validateLocalhostUrl('  http://localhost:3000')).toBeNull();
  });

  it('rejects null (not a string)', () => {
    expect(validateLocalhostUrl(null)).toBeNull();
  });

  it('rejects undefined (not a string)', () => {
    expect(validateLocalhostUrl(undefined)).toBeNull();
  });

  it('rejects 3000 (number not a string)', () => {
    expect(validateLocalhostUrl(3000)).toBeNull();
  });

  it('rejects empty string', () => {
    expect(validateLocalhostUrl('')).toBeNull();
  });

  // Case sensitivity — the pre-check regex is case-sensitive, and the URL parser
  // normalises protocol to lowercase, so HTTP:// fails the pre-check before parse.
  it('rejects HTTP://localhost:3000 (uppercase protocol)', () => {
    expect(validateLocalhostUrl('HTTP://localhost:3000')).toBeNull();
  });
});
