// tests/plugin-deps.spec.js
// TASK-023 — Plugin chain P3: runtime dependency packaging via ESBUILD BUNDLING.
//
// Authoritative design: tasks/TASK-020.research.md §B.4 and the TASK-023
// "APPROACH PIVOTED" comment (2026-05-29T01:45). The earlier data-dir/NODE_PATH
// lock was ABANDONED after attempt-1 (commit bd1ac0e) empirically proved ESM
// `import` ignores NODE_PATH. The locked-in mechanism is now:
//
//   esbuild BUNDLES each standalone Node entrypoint (bin/init.js,
//   bin/new-task.js) into a self-contained committed .cjs artifact under dist/,
//   with ALL deps INLINED (src/* modules + ajv + ajv-formats + gray-matter).
//   The installed plugin runs `node dist/<x>.cjs`; there is NO runtime module
//   resolution at all — no node_modules, no NODE_PATH, no SessionStart hook.
//
// Consequences encoded below:
//   • ajv/ajv-formats/gray-matter STAY in devDependencies (bundle-time only).
//   • NO hooks/setup-deps.* and NO SessionStart deps-hook may be introduced.
//   • The build output dir is `dist/` and MUST be COMMITTED (un-ignored).
//
// PINNED OUTPUT DIR: `dist/`  →  dist/init.cjs, dist/new-task.cjs
// PINNED BUILD SCRIPT: `npm run build:plugin` (package.json scripts.build:plugin)
//
// TESTS-FIRST: no impl exists yet — there is no build:plugin script, no esbuild
// devDependency entry, no dist/ artifacts, dist/ is still gitignored, and
// shipped-bin.json still points at raw bin/*.js. Each spec below MUST fail for
// the RIGHT reason (script/dep/file/ignore/wiring absent), never on a typo here.
//
// DETERMINISTIC + OFFLINE: we run esbuild (a fast, already-installed devDep)
// in-test to build into a TEMP outdir for the script/runtime proofs — we do NOT
// run `npm install`. The committed-artifact + git-tracked + .gitignore + wiring
// checks read the repo's on-disk/VCS state directly.

import { describe, it, expect, afterAll } from 'vitest';
import {
  existsSync, readFileSync, mkdirSync, copyFileSync, mkdtempSync, rmSync, symlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

import { REPO_ROOT } from '../helpers/repoRoot.js';

const PKG_JSON = join(REPO_ROOT, 'package.json');
const GITIGNORE = join(REPO_ROOT, '.gitignore');
const SHIPPED_BIN = join(REPO_ROOT, '.claude-plugin', 'shipped-bin.json');

// The pinned output dir + the two bundled entrypoints (MCP server bundle is P6).
const DIST_DIR = join(REPO_ROOT, 'dist');
const BUNDLES = [
  { entry: join(REPO_ROOT, 'bin', 'init.js'), out: 'init.cjs' },
  { entry: join(REPO_ROOT, 'bin', 'new-task.js'), out: 'new-task.cjs' },
];

const RUNTIME_DEPS = ['ajv', 'ajv-formats', 'gray-matter'];

// Module-resolution error surfaces a bundle would emit if a dep were NOT inlined.
const MODULE_RESOLUTION_ERROR = /(MODULE_NOT_FOUND|Cannot find module|Cannot find package|ERR_MODULE_NOT_FOUND)/;

// ---- tmp-dir bookkeeping (reaped after the suite) -------------------------
const __tmpDirs = [];
function makeTmp(label) {
  const p = mkdtempSync(join(tmpdir(), `${label}-`));
  __tmpDirs.push(p);
  return p;
}
afterAll(() => {
  for (const p of __tmpDirs) {
    try { rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* AV/EBUSY on win */ }
  }
});

function readJson(path) {
  expect(existsSync(path), `${path} must exist`).toBe(true);
  return JSON.parse(readFileSync(path, 'utf8')); // malformed JSON throws here — a "right" failure.
}

/** Build one entrypoint with esbuild into `outfile`. Mirrors the contract the
 *  build:plugin script must satisfy (bundle, node platform, cjs, self-contained,
 *  shebang preserved/added). Used by the script-independent runtime proof so the
 *  proof can run before the npm script exists. Throws on esbuild error. */
async function esbuildBundle(entry, outfile) {
  const esbuild = await import('esbuild');
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile,
    logLevel: 'silent',
  });
}

// ===========================================================================
// AC1 — esbuild is a devDependency and a `build:plugin` npm script exists.
// FAILS NOW: no scripts.build:plugin; esbuild only appears under "overrides"
// (transitive pin), not as a declared devDependency.
// ===========================================================================
describe('AC1 — build:plugin script + esbuild devDependency', () => {
  it('package_json_declares_esbuild_as_a_devDependency', () => {
    const pkg = readJson(PKG_JSON);
    const dev = pkg.devDependencies || {};
    expect(
      Object.prototype.hasOwnProperty.call(dev, 'esbuild'),
      'esbuild must be a declared devDependency (build-time bundler)',
    ).toBe(true);
    expect(typeof dev.esbuild).toBe('string');
    expect(dev.esbuild.length).toBeGreaterThan(0);
  });

  it('package_json_has_a_build_plugin_script', () => {
    const pkg = readJson(PKG_JSON);
    const scripts = pkg.scripts || {};
    expect(
      typeof scripts['build:plugin'],
      'package.json scripts must define "build:plugin"',
    ).toBe('string');
    expect(scripts['build:plugin'].length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// AC1/AC6 (deps policy) — the three runtime deps STAY in devDependencies under
// the bundling approach (inlined at build time, never resolved at runtime).
// This is the inverse of attempt-1's AC. Asserting they did NOT get moved to
// `dependencies` guards against an impl that reverts to the abandoned plan.
// PASSES TODAY (deps are already devDeps) — a regression guard, not a red test.
// ===========================================================================
describe('AC6 — runtime deps STAY devDependencies (bundled, not resolved)', () => {
  for (const dep of RUNTIME_DEPS) {
    it(`${dep}_remains_a_devDependency`, () => {
      const pkg = readJson(PKG_JSON);
      const dev = pkg.devDependencies || {};
      expect(
        Object.prototype.hasOwnProperty.call(dev, dep),
        `${dep} must stay in devDependencies (inlined by the bundle)`,
      ).toBe(true);
    });

    it(`${dep}_is_NOT_promoted_to_dependencies`, () => {
      const pkg = readJson(PKG_JSON);
      const deps = pkg.dependencies || {};
      expect(
        Object.prototype.hasOwnProperty.call(deps, dep),
        `${dep} must NOT be in "dependencies" — bundling inlines it, the ` +
          `data-dir/NODE_PATH approach that required this move is abandoned`,
      ).toBe(false);
    });
  }
});

// ===========================================================================
// AC5 — NO SessionStart deps-hook / NODE_PATH machinery is introduced. The
// abandoned approach's hooks/setup-deps.* and a deps-oriented SessionStart hook
// must NOT exist. (resolveRepoRoot's cwd fallback, shipped in TASK-022, is the
// project-root mechanism; CLAUDE_PROJECT_DIR robustness is moot under bundling.)
// PASSES TODAY — a guard that impl does not resurrect the hook.
// ===========================================================================
describe('AC5 — no SessionStart deps-hook under bundling', () => {
  it('hooks_setup_deps_script_does_not_exist', () => {
    for (const name of ['setup-deps.mjs', 'setup-deps.js', 'setup-deps.cjs']) {
      expect(
        existsSync(join(REPO_ROOT, 'hooks', name)),
        `hooks/${name} must NOT exist — bundling needs no first-run install hook`,
      ).toBe(false);
    }
  });

  it('no_hooks_json_registers_a_deps_install_SessionStart_hook', () => {
    // If a hooks/hooks.json exists at all (it may for unrelated reasons later),
    // it must not wire a deps-install/NODE_PATH SessionStart command. Absent
    // file ⇒ trivially satisfied.
    const hooksJson = join(REPO_ROOT, 'hooks', 'hooks.json');
    if (!existsSync(hooksJson)) {
      expect(true).toBe(true);
      return;
    }
    const raw = readFileSync(hooksJson, 'utf8');
    expect(
      /setup-deps|NODE_PATH|CLAUDE_PLUGIN_DATA/.test(raw),
      'hooks.json must not reference the abandoned deps-install machinery',
    ).toBe(false);
  });
});

// ===========================================================================
// AC1 (build behavior) — running the build produces ONE self-contained .cjs per
// entrypoint with an inlined deps + a single shebang. Testable split chosen:
//   (a) THIS block builds each entrypoint into a TEMP outdir via esbuild (the
//       same contract build:plugin must meet) and asserts self-containment —
//       no committed artifact required, deterministic, offline.
//   (b) The next block asserts the COMMITTED artifacts exist + are git-tracked.
// (a) can PASS once esbuild is invoked correctly; it FAILS NOW only if esbuild
// is somehow unavailable — its real job is to pin the self-containment contract.
// ===========================================================================
describe('AC1 — esbuild produces a self-contained bundle per entrypoint', () => {
  for (const { entry, out } of BUNDLES) {
    it(`builds_${out}_as_a_single_self_contained_file`, async () => {
      const tmp = makeTmp('af-eb-build');
      const outfile = join(tmp, out);
      await esbuildBundle(entry, outfile);

      expect(existsSync(outfile), `${out} must be emitted`).toBe(true);
      const code = readFileSync(outfile, 'utf8');

      // Self-contained: NO leftover bare runtime `require('ajv'|…)` / dynamic
      // import of a runtime dep — they must be inlined, not referenced.
      for (const dep of RUNTIME_DEPS) {
        const escaped = dep.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
        const bareRequire = new RegExp(`require\\((['"\`])${escaped}\\1\\)`);
        expect(
          bareRequire.test(code),
          `${out} must NOT keep a bare require('${dep}') — esbuild must inline it`,
        ).toBe(false);
      }
      // Evidence the bundle actually pulled the dep in (ajv ships recognizable
      // tokens). A bundle that merely dropped the import would be tiny + lack it.
      expect(code.length).toBeGreaterThan(50_000);
    });

    it(`${out}_has_exactly_one_shebang_as_the_very_first_line`, async () => {
      // The shipped bundle must be directly executable: a single
      // `#!/usr/bin/env node` shebang, and it must be byte-0 (a second shebang
      // on line 2 — esbuild's banner duplicating the entry's own shebang — is a
      // SyntaxError; attempt-probe confirmed this footgun).
      const tmp = makeTmp('af-eb-shebang');
      const outfile = join(tmp, out);
      await esbuildBundle(entry, outfile);
      const code = readFileSync(outfile, 'utf8');
      const lines = code.split('\n');
      expect(lines[0]).toBe('#!/usr/bin/env node');
      const shebangCount = lines.filter((l) => l.startsWith('#!')).length;
      expect(
        shebangCount,
        `${out} must have exactly ONE shebang line (two = parse error)`,
      ).toBe(1);
    });
  }
});

// ===========================================================================
// AC3 — build output is COMMITTED and NOT gitignored.
// FAILS NOW: .gitignore still has a `dist/` line; nothing is tracked under dist/.
// ===========================================================================
describe('AC3 — bundle artifacts are committed (not gitignored)', () => {
  it('gitignore_no_longer_ignores_the_dist_output_dir', () => {
    expect(existsSync(GITIGNORE), '.gitignore must exist').toBe(true);
    const lines = readFileSync(GITIGNORE, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    // A bare `dist/` (or `dist`, `/dist`) ignore line must be gone so the
    // committed bundles are tracked. A negation (`!dist/...`) is fine.
    const ignoresDist = lines.some((l) => /^\/?dist\/?$/.test(l));
    expect(
      ignoresDist,
      '.gitignore must NOT ignore dist/ — the bundles are committed artifacts',
    ).toBe(false);
  });

  for (const { out } of BUNDLES) {
    it(`dist_${out}_is_tracked_by_git`, () => {
      const rel = `dist/${out}`;
      const r = spawnSync('git', ['ls-files', '--error-unmatch', rel], {
        cwd: REPO_ROOT, encoding: 'utf8',
      });
      expect(
        r.status,
        `${rel} must be tracked by git (committed bundle); git ls-files said: ` +
          `${(r.stdout || '').trim()}${(r.stderr || '').trim()}`,
      ).toBe(0);
    });
  }
});

// ===========================================================================
// AC2 — RUNTIME RESOLUTION PROOF (the key AC). Copy a built bundle into a temp
// dir with NO node_modules anywhere up-tree and actually RUN it; assert there is
// NO module-resolution error — proving deps are INLINED, not resolved at runtime.
//
// We build into the temp dir directly (esbuild, offline) rather than depending
// on a committed artifact, so this proof runs in the tests-first phase too. The
// OS tmp dir was verified (attempt-1) to have no node_modules up-tree.
//
// We invoke `node <bundle> <a-flag-that-makes-it-exit-fast>` and assert the
// stderr contains NO MODULE_NOT_FOUND-class error. A normal nonzero CLI exit
// (e.g. "unknown flag") is fine — we are proving DEP RESOLUTION, not behavior.
// A SECOND, clearly-labeled assertion requires the bundle to also initialize
// cleanly (reach arg-parsing) so an `import.meta.url`/asset-load crash under
// bundling is caught and handed to impl as a precise signal.
// ===========================================================================
describe('AC2 — bundle runs with deps inlined, no node_modules up-tree', () => {
  for (const { entry, out } of BUNDLES) {
    it(`${out}_loads_with_no_MODULE_NOT_FOUND_in_isolation`, async () => {
      const isoRoot = makeTmp('af-eb-iso');
      const outfile = join(isoRoot, out);
      await esbuildBundle(entry, outfile);
      // Sanity: nothing resolvable up-tree from the iso dir.
      expect(existsSync(join(isoRoot, 'node_modules'))).toBe(false);

      const cleanEnv = { ...process.env };
      delete cleanEnv.NODE_PATH;
      const r = spawnSync(
        process.execPath,
        [outfile, '--__af_probe_unknown_flag__'],
        { cwd: isoRoot, env: cleanEnv, encoding: 'utf8' },
      );
      const stderr = r.stderr || '';

      // THE AC: deps are inlined ⇒ no module-resolution failure.
      expect(
        MODULE_RESOLUTION_ERROR.test(stderr),
        `bundle ${out} hit a module-resolution error in isolation — a dep was ` +
          `NOT inlined. stderr:\n${stderr.slice(0, 600)}`,
      ).toBe(false);
    });

    it(`${out}_initializes_cleanly_under_bundling_no_import_meta_crash`, async () => {
      // Stronger guard: the bundle must actually load to arg-parsing. Under cjs
      // bundling, src/task-store.js + src/project-md.js read schema assets via
      // `fileURLToPath(import.meta.url)`, which esbuild empties → a crash unless
      // impl handles it (define/inject the path, ship the schema beside the
      // bundle, or inline the JSON). This fails loudly so impl gets a precise
      // signal; it is NOT a node_modules problem (covered above).
      const isoRoot = makeTmp('af-eb-iso-init');
      const outfile = join(isoRoot, out);
      await esbuildBundle(entry, outfile);

      const cleanEnv = { ...process.env };
      delete cleanEnv.NODE_PATH;
      const r = spawnSync(
        process.execPath,
        [outfile, '--__af_probe_unknown_flag__'],
        { cwd: isoRoot, env: cleanEnv, encoding: 'utf8' },
      );
      const stderr = r.stderr || '';
      const initCrash = /(import\.meta|fileURLToPath|ERR_INVALID_ARG_TYPE|ENOENT)/.test(stderr);
      expect(
        initCrash,
        `bundle ${out} crashed during module init (likely import.meta.url / ` +
          `schema-asset resolution under bundling). impl must handle the ` +
          `import.meta.url asset reads. stderr:\n${stderr.slice(0, 600)}`,
      ).toBe(false);
    });
  }
});

// ===========================================================================
// AC4 — shipped entrypoints point at the COMMITTED BUNDLES, not raw bin/*.js.
// shipped-bin.json currently lists ["init.js", "new-task.js"] (bin sources) →
// FAILS NOW. The shipped surface must reference the dist/ bundles instead.
// (Representation kept deliberately loose on the exact key/shape so impl can
// choose; the invariant: each listed shipped entry resolves to a dist/*.cjs
// bundle, and no entry is a bare bin/*.js source.)
// ===========================================================================
describe('AC4 — shipped-bin points at the committed bundles', () => {
  it('shipped_bin_manifest_exists', () => {
    const m = readJson(SHIPPED_BIN);
    expect(typeof m).toBe('object');
    expect(m).not.toBeNull();
  });

  it('every_shipped_entry_references_a_dist_bundle_not_a_raw_bin_source', () => {
    const m = readJson(SHIPPED_BIN);
    expect(Array.isArray(m.bin), 'shipped-bin.json must list a `bin` array').toBe(true);
    expect(m.bin.length).toBeGreaterThan(0);
    for (const entry of m.bin) {
      expect(typeof entry).toBe('string');
      // Must point into dist/ and be a .cjs bundle.
      expect(
        /(^|\/)dist\//.test(entry) && entry.endsWith('.cjs'),
        `shipped entry "${entry}" must reference a dist/*.cjs bundle, not raw bin/*.js`,
      ).toBe(true);
      // And must not be a bare bin source filename.
      expect(/^(init|new-task)\.js$/.test(entry)).toBe(false);
    }
  });

  it('shipped_entries_cover_init_and_new_task_bundles', () => {
    const m = readJson(SHIPPED_BIN);
    const joined = (m.bin || []).join('|');
    expect(joined).toMatch(/init\.cjs/);
    expect(joined).toMatch(/new-task\.cjs/);
  });
});

// ===========================================================================
// DOCUMENTATION GUARDS (carried over from attempt-1) — WHY bundling, not
// NODE_PATH. These prove the runtime facts that drove the pivot. They PASS
// today and stand as executable rationale, not red tests-first specs.
//
// Kept because a future maintainer (or a re-litigation of the approach) needs
// the falsifiable evidence: (1) ESM ignores NODE_PATH; (2) the only non-bundle
// way to resolve is an adjacent up-tree node_modules — which the pivot rejected
// in favor of inlining.
// ===========================================================================
describe('DOC — runtime facts that motivate bundling over NODE_PATH', () => {
  const REPO_NM = join(REPO_ROOT, 'node_modules');
  const haveDevInstall = existsSync(join(REPO_NM, 'ajv')) && existsSync(join(REPO_NM, 'ajv-formats'));

  function isolatedTaskStoreCopy() {
    const root = makeTmp('af-doc-iso');
    const srcDir = join(root, 'src');
    const tasksDir = join(root, 'tasks');
    mkdirSync(srcDir, { recursive: true });
    mkdirSync(tasksDir, { recursive: true });
    copyFileSync(join(REPO_ROOT, 'src', 'task-store.js'), join(srcDir, 'task-store.js'));
    copyFileSync(join(REPO_ROOT, 'src', 'atomic-write.js'), join(srcDir, 'atomic-write.js'));
    // TASK-188 AC3 — task-store.js now imports close-guard.js directly
    // (loopModeCloseGuard as resolveCloseGuard's default), which pulls in its
    // own real dependency closure (pointer.js, bundle.js, operating-mode.js,
    // and bundle.js's own host.js/schemas.js). This isolated copy must mirror
    // that closure or the import legitimately 404s on close-guard.js — same
    // "only an adjacent node_modules resolves ESM" class of runtime fact this
    // describe block exists to pin, not a defect in the guard being proven.
    copyFileSync(join(REPO_ROOT, 'src', 'close-guard.js'), join(srcDir, 'close-guard.js'));
    copyFileSync(join(REPO_ROOT, 'src', 'pointer.js'), join(srcDir, 'pointer.js'));
    copyFileSync(join(REPO_ROOT, 'src', 'bundle.js'), join(srcDir, 'bundle.js'));
    copyFileSync(join(REPO_ROOT, 'src', 'operating-mode.js'), join(srcDir, 'operating-mode.js'));
    copyFileSync(join(REPO_ROOT, 'src', 'host.js'), join(srcDir, 'host.js'));
    copyFileSync(join(REPO_ROOT, 'src', 'schemas.js'), join(srcDir, 'schemas.js'));
    // TASK-201 — task-store.js now imports intake-sanitizer.js directly
    // (stripInvisibleChars, reused from TASK-159 for the comment-body
    // invisible-Unicode guard). intake-sanitizer.js itself has zero imports
    // (pure functions only), so no further transitive copy is needed.
    copyFileSync(join(REPO_ROOT, 'src', 'intake-sanitizer.js'), join(srcDir, 'intake-sanitizer.js'));
    copyFileSync(join(REPO_ROOT, 'tasks', 'schema.json'), join(tasksDir, 'schema.json'));
    return { root, srcDir };
  }

  function spawnImport(srcDir, env) {
    const url = pathToFileURL(join(srcDir, 'task-store.js')).href;
    const code = `import(${JSON.stringify(url)})`
      + `.then((m) => { process.stdout.write(typeof m.createTask === 'function' ? 'IMPORT_OK' : 'NO_EXPORT'); })`
      + `.catch((e) => { process.stderr.write('ERR:' + (e && e.code || 'UNKNOWN')); process.exit(3); });`;
    const cleanEnv = { ...process.env };
    delete cleanEnv.NODE_PATH;
    return spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      cwd: srcDir, env: { ...cleanEnv, ...env }, encoding: 'utf8',
    });
  }

  it.skipIf(!haveDevInstall)('ESM_import_IGNORES_NODE_PATH', () => {
    const { srcDir } = isolatedTaskStoreCopy();
    const r = spawnImport(srcDir, { NODE_PATH: REPO_NM });
    expect(r.status, `NODE_PATH-only should fail for ESM; stderr=${r.stderr}`).not.toBe(0);
    expect(r.stderr).toContain('ERR:ERR_MODULE_NOT_FOUND');
  });

  it.skipIf(!haveDevInstall)('only_an_adjacent_up_tree_node_modules_resolves_ESM', () => {
    const { root, srcDir } = isolatedTaskStoreCopy();
    const linked = join(root, 'node_modules');
    try {
      symlinkSync(REPO_NM, linked, 'junction');
    } catch (e) {
      throw new Error(`could not create node_modules junction: ${e.code || e.message}`);
    }
    const r = spawnImport(srcDir, {});
    expect(r.stdout.trim(), `expected IMPORT_OK; stderr=${r.stderr}`).toBe('IMPORT_OK');
    expect(r.status).toBe(0);
  });
});
