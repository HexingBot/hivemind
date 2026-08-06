// tests/e2e/mcp-build-status.spec.js
// TASK-204 — the mechanical MCP-server-staleness detector: mcp_build_status.
//
// THE PROBLEM (see src/mcp-server.js's top-of-file "MCP SERVER STALENESS IS
// DETECTABLE" comment for the full write-up): dist/mcp-server.cjs runs as a
// long-lived stdio process. A guard rebuilt into the bundle and committed is
// NOT executing in any process that started before the rebuild, and nothing
// signals the gap. Confirmed twice empirically (TASK-200, TASK-201) before
// this ticket landed the fix below.
//
// THE MECHANISM UNDER TEST: main() snapshots a sha256 of the file THIS
// process loaded (computeBuildStamp), once, before the server ever connects.
// checkBundleFreshness (wrapped by the mcp_build_status tool) re-hashes the
// SAME path on demand and reports `stale: true` the instant the two hashes
// diverge — i.e. the instant a rebuild has landed bytes this process never
// loaded. These specs prove the mechanism actually fires on a genuinely
// stale bundle and stays quiet on a fresh one (real evidence, not a
// description) by simulating the rebuild: overwrite the SAME path a
// snapshot was taken against, then check again.
//
// This is a regression LOCK for a mechanism whose removal must be caught:
// deleting the mcp_build_status tool registration, or replacing
// checkBundleFreshness's real re-hash-and-compare with a hardcoded
// `stale: false`, fails the "fires_on_a_stale_bundle..." test below.

import {
  describe, it, expect, beforeEach, afterEach,
} from 'vitest';
import {
  mkdtempSync, rmSync, writeFileSync, unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createServer, computeBuildStamp, checkBundleFreshness } from '../../src/mcp-server.js';
import { makeRepoSkeleton } from '../helpers/fixtures.js';

function parse(result) {
  return JSON.parse(result.content[0].text);
}

describe('TASK-204 — computeBuildStamp / checkBundleFreshness (pure mechanism)', () => {
  let dir;
  let bundlePath;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mcp-build-status-'));
    bundlePath = join(dir, 'fake-bundle.cjs');
    writeFileSync(bundlePath, 'console.log("v1");\n', 'utf8');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('computeBuildStamp_hashes_the_files_current_bytes_not_just_its_presence', async () => {
    const stamp = await computeBuildStamp(bundlePath);
    expect(stamp.path).toBe(bundlePath);
    expect(stamp.sha256).toMatch(/^[0-9a-f]{64}$/);

    const before = stamp.sha256;
    writeFileSync(bundlePath, 'console.log("v2");\n', 'utf8');
    const stampAfter = await computeBuildStamp(bundlePath);
    expect(stampAfter.sha256).not.toBe(before);
  });

  it('checkBundleFreshness_reports_checked_false_no_build_stamp_when_no_stamp_was_given', async () => {
    const result = await checkBundleFreshness(null);
    expect(result).toEqual({
      checked: false, reason: 'no-build-stamp', stale: null, path: null,
    });
  });

  it('checkBundleFreshness_stays_quiet_stale_false_on_a_fresh_unchanged_file', async () => {
    const stamp = await computeBuildStamp(bundlePath);
    const result = await checkBundleFreshness(stamp);
    expect(result.checked).toBe(true);
    expect(result.stale).toBe(false);
    expect(result.loaded_sha256).toBe(result.current_sha256);
  });

  it('checkBundleFreshness_fires_stale_true_the_moment_the_snapshotted_path_changes_on_disk', async () => {
    // The motivating scenario, reduced to its essence: snapshot (main() at
    // process start), then a rebuild lands new bytes at the SAME path while
    // the "process" (this test) keeps running unchanged.
    const stamp = await computeBuildStamp(bundlePath);
    writeFileSync(bundlePath, 'console.log("v2 - rebuilt");\n', 'utf8');
    const result = await checkBundleFreshness(stamp);
    expect(result.checked).toBe(true);
    expect(result.stale).toBe(true);
    expect(result.loaded_sha256).not.toBe(result.current_sha256);
  });

  it('checkBundleFreshness_reports_checked_false_bundle_missing_when_the_snapshotted_path_is_deleted', async () => {
    const stamp = await computeBuildStamp(bundlePath);
    unlinkSync(bundlePath);
    const result = await checkBundleFreshness(stamp);
    expect(result).toEqual({
      checked: false, reason: 'bundle-missing', stale: null, path: bundlePath,
    });
  });
});

describe('TASK-204 — mcp_build_status tool (full in-memory MCP round trip)', () => {
  let repoRoot;
  let dir;
  let bundlePath;
  let client;
  let server;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'mcp-build-status-repo-'));
    makeRepoSkeleton(repoRoot);
    dir = mkdtempSync(join(tmpdir(), 'mcp-build-status-bundle-'));
    bundlePath = join(dir, 'fake-bundle.cjs');
    writeFileSync(bundlePath, 'console.log("v1");\n', 'utf8');
  });

  afterEach(async () => {
    if (client) await client.close();
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  });

  async function connect(buildStamp) {
    server = createServer({ repoRoot, buildStamp });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'task-204-test', version: '0.0.0' });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
  }

  it('reports_checked_false_no_build_stamp_when_createServer_is_called_without_one', async () => {
    // The exact shape every OTHER spec in this repo exercises createServer
    // in (no buildStamp arg) — must never fabricate a fresh/stale verdict.
    await connect(undefined);
    const result = parse(await client.callTool({ name: 'mcp_build_status', arguments: {} }));
    expect(result).toEqual({
      checked: false, reason: 'no-build-stamp', stale: null, path: null,
    });
  });

  it('stays_quiet_stale_false_on_a_fresh_bundle', async () => {
    const stamp = await computeBuildStamp(bundlePath);
    await connect(stamp);
    const result = parse(await client.callTool({ name: 'mcp_build_status', arguments: {} }));
    expect(result.checked).toBe(true);
    expect(result.stale).toBe(false);
  });

  it('fires_stale_true_when_the_committed_bundle_changes_underneath_the_running_process', async () => {
    const stamp = await computeBuildStamp(bundlePath);
    await connect(stamp);

    // Simulate a rebuild landing new bytes at the SAME path this "process"
    // loaded at connect time — the exact TASK-204 motivating scenario
    // (TASK-200's close-evidence guard / TASK-201's sanitizer, inert in the
    // session that shipped them).
    writeFileSync(bundlePath, 'console.log("v2 - rebuilt while the process kept running");\n', 'utf8');

    const result = parse(await client.callTool({ name: 'mcp_build_status', arguments: {} }));
    expect(result.checked).toBe(true);
    expect(result.stale).toBe(true);
    expect(result.loaded_sha256).not.toBe(result.current_sha256);
  });
});
