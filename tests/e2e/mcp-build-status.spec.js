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
// FIX-ROUND CORRECTION (reviewer HIGH-1/HIGH-2): the mechanism is TWO
// independent legs, not one. `.mcp.json` spawns
// `${CLAUDE_PLUGIN_ROOT}/dist/mcp-server.cjs`, and for an installed plugin
// `CLAUDE_PLUGIN_ROOT` is a plugin CACHE (populated from the marketplace's
// remote git URL) — a DIFFERENT file from this repo's own
// `dist/mcp-server.cjs`, the only file `npm run build:plugin` / dist-parity
// ever touch. A single leg that only re-hashes "the path this process was
// spawned from" (LEG 1 / self_stale below) reports `self_stale: false`
// forever in that topology, no matter how far the cache drifts from the
// repo — the ORIGINAL single-leg version of this file would have stayed
// green through both TASK-200 and TASK-201. LEG 2 / repo_divergent is the
// leg that actually answers "does the live process reflect THIS repo's
// committed bundle", independent of which path the process was spawned
// from. The "stamped_path_is_not_the_repo_bundle..." tests below are the
// ones that would have caught HIGH-1: they stamp one path and mutate a
// DIFFERENT path (the repo's dist/mcp-server.cjs), proving repo_divergent
// fires even while self_stale stays quiet.
//
// This is a regression LOCK for a mechanism whose removal must be caught:
// deleting the mcp_build_status tool registration, or replacing either leg's
// real re-hash-and-compare with a hardcoded `false`, fails the
// "fires_..." tests below.

import {
  describe, it, expect, beforeEach, afterEach,
} from 'vitest';
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, unlinkSync,
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

  it('checkBundleFreshness_disables_both_legs_when_no_build_stamp_was_given', async () => {
    const result = await checkBundleFreshness(null, dir);
    expect(result).toEqual({
      checked: false,
      reason: 'no-build-stamp',
      self_stale: null,
      loaded_path: null,
      loaded_sha256: null,
      current_self_sha256: null,
      repo_checked: false,
      repo_reason: 'no-build-stamp',
      repo_divergent: null,
      repo_path: null,
      repo_sha256: null,
    });
  });

  it('leg1_self_stays_quiet_self_stale_false_on_a_fresh_unchanged_file', async () => {
    const stamp = await computeBuildStamp(bundlePath);
    const result = await checkBundleFreshness(stamp, null);
    expect(result.checked).toBe(true);
    expect(result.self_stale).toBe(false);
    expect(result.loaded_sha256).toBe(result.current_self_sha256);
  });

  it('leg1_self_fires_self_stale_true_the_moment_the_snapshotted_path_changes_on_disk', async () => {
    // The self-leg motivating case, reduced to its essence: snapshot
    // (main() at process start), then bytes change at the SAME path while
    // the "process" (this test) keeps running unchanged.
    const stamp = await computeBuildStamp(bundlePath);
    writeFileSync(bundlePath, 'console.log("v2 - rebuilt");\n', 'utf8');
    const result = await checkBundleFreshness(stamp, null);
    expect(result.checked).toBe(true);
    expect(result.self_stale).toBe(true);
    expect(result.loaded_sha256).not.toBe(result.current_self_sha256);
  });

  it('leg1_self_reports_checked_false_bundle_missing_when_the_snapshotted_path_is_deleted', async () => {
    const stamp = await computeBuildStamp(bundlePath);
    unlinkSync(bundlePath);
    const result = await checkBundleFreshness(stamp, null);
    expect(result.checked).toBe(false);
    expect(result.reason).toBe('bundle-missing');
    expect(result.self_stale).toBeNull();
  });

  it('leg2_repo_reports_repo_checked_false_no_repo_root_when_no_repoRoot_is_given', async () => {
    const stamp = await computeBuildStamp(bundlePath);
    const result = await checkBundleFreshness(stamp, undefined);
    expect(result.repo_checked).toBe(false);
    expect(result.repo_reason).toBe('no-repo-root');
    expect(result.repo_divergent).toBeNull();
  });

  it('leg2_repo_reports_repo_checked_false_repo_bundle_missing_for_a_repoRoot_with_no_dist', async () => {
    // The normal, legitimate case for a consumer project: no dist/ checked
    // out at all. Never collapsed into repo_divergent: false.
    const stamp = await computeBuildStamp(bundlePath);
    const emptyRepoRoot = mkdtempSync(join(tmpdir(), 'mcp-build-status-norepo-'));
    try {
      const result = await checkBundleFreshness(stamp, emptyRepoRoot);
      expect(result.repo_checked).toBe(false);
      expect(result.repo_reason).toBe('repo-bundle-missing');
      expect(result.repo_divergent).toBeNull();
    } finally {
      rmSync(emptyRepoRoot, { recursive: true, force: true });
    }
  });

  it('leg2_repo_stays_quiet_repo_divergent_false_when_the_repo_bundle_matches_what_was_loaded', async () => {
    const stamp = await computeBuildStamp(bundlePath);
    const repoRoot = mkdtempSync(join(tmpdir(), 'mcp-build-status-samerepo-'));
    try {
      mkdirSync(join(repoRoot, 'dist'), { recursive: true });
      writeFileSync(join(repoRoot, 'dist', 'mcp-server.cjs'), 'console.log("v1");\n', 'utf8');
      const result = await checkBundleFreshness(stamp, repoRoot);
      expect(result.repo_checked).toBe(true);
      expect(result.repo_divergent).toBe(false);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  // ---------------------------------------------------------------------------
  // HIGH-1/HIGH-2 fix-round test: the stamped path is NOT the repo's
  // dist/mcp-server.cjs (the installed-plugin-cache topology). A rebuild
  // only ever touches the REPO path, never the stamped (cache) path — this
  // is exactly the shape a self-only check misses, and exactly the shape
  // this test proves the repo leg catches.
  // ---------------------------------------------------------------------------
  it('leg2_repo_fires_repo_divergent_true_when_the_repo_bundle_changes_even_though_the_stamped_cache_path_never_does', async () => {
    // "bundlePath" here stands in for CLAUDE_PLUGIN_ROOT's cache copy — the
    // path this "process" actually loaded from and will keep using
    // unmodified for the rest of this test.
    const stamp = await computeBuildStamp(bundlePath);
    const repoRoot = mkdtempSync(join(tmpdir(), 'mcp-build-status-divergerepo-'));
    try {
      mkdirSync(join(repoRoot, 'dist'), { recursive: true });
      const repoDistPath = join(repoRoot, 'dist', 'mcp-server.cjs');
      writeFileSync(repoDistPath, 'console.log("v1");\n', 'utf8'); // starts identical

      // `npm run build:plugin` lands new bytes at the REPO path — the cache
      // path (bundlePath) is never touched, exactly as in the real
      // installed-plugin topology.
      writeFileSync(repoDistPath, 'console.log("v2 - rebuilt in the repo, not the cache");\n', 'utf8');

      const result = await checkBundleFreshness(stamp, repoRoot);
      // Leg 1 correctly stays quiet: the CACHE path itself never changed.
      expect(result.checked).toBe(true);
      expect(result.self_stale).toBe(false);
      // Leg 2 correctly fires: the REPO's committed bundle has moved on.
      expect(result.repo_checked).toBe(true);
      expect(result.repo_divergent).toBe(true);
      expect(result.repo_sha256).not.toBe(result.loaded_sha256);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
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

  it('disables_both_legs_when_createServer_is_called_without_a_buildStamp', async () => {
    // The exact shape every OTHER spec in this repo exercises createServer
    // in (no buildStamp arg) — must never fabricate a matching verdict.
    await connect(undefined);
    const result = parse(await client.callTool({ name: 'mcp_build_status', arguments: {} }));
    expect(result.checked).toBe(false);
    expect(result.reason).toBe('no-build-stamp');
    expect(result.repo_checked).toBe(false);
    expect(result.repo_reason).toBe('no-build-stamp');
  });

  it('leg1_self_fires_self_stale_true_when_the_stamped_path_itself_changes_underneath_the_running_process', async () => {
    const stamp = await computeBuildStamp(bundlePath);
    await connect(stamp);

    // Simulate a rebuild landing new bytes at the SAME path this "process"
    // loaded at connect time — the dev-checkout self-hosting case, where the
    // loaded path and the repo path happen to coincide.
    writeFileSync(bundlePath, 'console.log("v2 - rebuilt while the process kept running");\n', 'utf8');

    const result = parse(await client.callTool({ name: 'mcp_build_status', arguments: {} }));
    expect(result.checked).toBe(true);
    expect(result.self_stale).toBe(true);
    expect(result.loaded_sha256).not.toBe(result.current_self_sha256);
  });

  // ---------------------------------------------------------------------------
  // HIGH-1/HIGH-2 fix-round: the full-round-trip version of the divergence
  // proof above — this repoRoot (a fresh makeRepoSkeleton fixture) has NO
  // dist/ at all, so the repo leg legitimately reports checked:false rather
  // than a false "matching". Adding a real dist/mcp-server.cjs and mutating
  // it after connect is what flips repo_divergent to true, via the ACTUAL
  // mcp_build_status tool call — not just the pure function.
  // ---------------------------------------------------------------------------
  it('leg2_repo_fires_repo_divergent_true_through_the_real_tool_call_when_the_repo_bundle_diverges_from_the_stamped_cache_path', async () => {
    const stamp = await computeBuildStamp(bundlePath);
    await connect(stamp);

    // Before any repo dist/ exists: legitimately unverifiable, not a false
    // "matching".
    const before = parse(await client.callTool({ name: 'mcp_build_status', arguments: {} }));
    expect(before.repo_checked).toBe(false);
    expect(before.repo_reason).toBe('repo-bundle-missing');

    // A real dist/mcp-server.cjs lands in the repo — starts identical to
    // what this "process" loaded, then a rebuild (a SECOND write, to the
    // REPO path only — bundlePath, standing in for the plugin cache, is
    // never touched) diverges it.
    mkdirSync(join(repoRoot, 'dist'), { recursive: true });
    const repoDistPath = join(repoRoot, 'dist', 'mcp-server.cjs');
    writeFileSync(repoDistPath, 'console.log("v1");\n', 'utf8');
    writeFileSync(repoDistPath, 'console.log("v2 - rebuilt in the repo, not the cache");\n', 'utf8');

    const after = parse(await client.callTool({ name: 'mcp_build_status', arguments: {} }));
    expect(after.self_stale).toBe(false); // the cache path itself never changed
    expect(after.repo_checked).toBe(true);
    expect(after.repo_divergent).toBe(true);
    expect(after.repo_sha256).not.toBe(after.loaded_sha256);
  });
});
