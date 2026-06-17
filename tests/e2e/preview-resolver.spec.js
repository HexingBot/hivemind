// tests/e2e/preview-resolver.spec.js
// TASK-065 — Slow-tier (real-disk) spec for src/preview-resolver.js.
//
// ACs covered:
//   AC1 — resolvePreviewConfig({repoRoot}) returns the normalized shape
//          { mode, command, cwd, url, source } in all cases.
//   AC2 — Configured path: preview block in PROJECT.md frontmatter takes
//          precedence over inference. preview_command + preview_url →
//          mode=web, source=configured. preview_mode defaults to 'web' when
//          url/port present, else 'process'. preview_port is converted to a
//          url when preview_url is absent.
//   AC3 — Inference fallback: no preview config → scan package.json scripts
//          in order dev > start > serve. mode=web when port/url derivable,
//          else mode=process. source=inferred.
//   AC4 — No config AND no usable script → {mode:'none',source:'none'}, no throw.
//   AC5 — Backward-compat: existing PROJECT.md with no preview fields still
//          parses; yields source=none (or source=inferred if package.json
//          scripts exist). The new preview fields are optional.
//   AC6 — (test phase) precedence: configured > inferred > none across three
//          scenario types. Covered by the fixture matrix below.
//
// Port-derivation heuristic encoded in tests:
//   A script string is considered port-derivable (→ mode=web) when it contains
//   any of: `--port <N>`, `-p <N>`, `PORT=<N>`, `localhost:<N>`, `0.0.0.0:<N>`.
//   The resolver returns url=`http://localhost:<N>` in that case.
//   A script with none of those patterns → mode=process, url=null.
//
// Disk I/O / tmpdir → slow tier, lives in tests/e2e/.

import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

// ---------------------------------------------------------------------------
// Resolve production module
// ---------------------------------------------------------------------------
const __thisDir = dirname(fileURLToPath(import.meta.url));
const __srcDir = join(__thisDir, '..', '..', 'src');
const PREVIEW_RESOLVER_URL = pathToFileURL(join(__srcDir, 'preview-resolver.js')).href;

// ---------------------------------------------------------------------------
// Helpers to build temp repo fixtures
// ---------------------------------------------------------------------------

/**
 * Build a minimal PROJECT.md with optional frontmatter fields.
 * Required fields: name, type, created_at, schema_version.
 * Optional preview fields: preview_command, preview_url, preview_port, preview_mode.
 */
function makeProjectMd(opts = {}) {
  const {
    name = 'test-project',
    type = 'web-saas',
    createdAt = '2026-06-16T12:00:00Z',
    schemaVersion = 1,
    previewCommand = undefined,
    previewUrl = undefined,
    previewPort = undefined,
    previewMode = undefined,
  } = opts;

  const lines = [
    '---',
    `name: ${name}`,
    `type: ${type}`,
    `created_at: ${createdAt}`,
    `schema_version: ${schemaVersion}`,
  ];

  if (previewCommand !== undefined) lines.push(`preview_command: ${previewCommand}`);
  if (previewUrl !== undefined) lines.push(`preview_url: ${previewUrl}`);
  if (previewPort !== undefined) lines.push(`preview_port: ${previewPort}`);
  if (previewMode !== undefined) lines.push(`preview_mode: ${previewMode}`);

  lines.push('---', '', `# ${name}`, '');
  return lines.join('\n');
}

/**
 * Build a package.json with the given scripts map.
 */
function makePackageJson(scripts = {}) {
  return JSON.stringify({ name: 'test-project', version: '0.0.1', scripts }, null, 2);
}

/**
 * Write a PROJECT.md fixture under repoRoot and return repoRoot.
 */
function writeProjectMd(repoRoot, opts = {}) {
  writeFileSync(join(repoRoot, 'PROJECT.md'), makeProjectMd(opts), 'utf8');
  return repoRoot;
}

/**
 * Write a package.json fixture under repoRoot and return repoRoot.
 */
function writePackageJson(repoRoot, scripts = {}) {
  writeFileSync(join(repoRoot, 'package.json'), makePackageJson(scripts), 'utf8');
  return repoRoot;
}

// ---------------------------------------------------------------------------
// AC1 + AC4 — no PROJECT.md, no package.json → {mode:'none',source:'none'}
// ---------------------------------------------------------------------------
describe('AC4 — no config, no scripts → mode=none, source=none, no throw', () => {
  it('returns none shape when repo has neither PROJECT.md nor package.json', async () => {
    const { resolvePreviewConfig } = await import(PREVIEW_RESOLVER_URL);
    const repoRoot = makeTmpDir('af-pr-none');

    const result = await resolvePreviewConfig({ repoRoot });

    expect(result.mode).toBe('none');
    expect(result.source).toBe('none');
    expect(result.command).toBeNull();
    expect(result.url).toBeNull();
    // cwd should still be the repoRoot (always set regardless of outcome).
    expect(result.cwd).toBe(repoRoot);
  });

  it('does not throw when both PROJECT.md and package.json are absent', async () => {
    const { resolvePreviewConfig } = await import(PREVIEW_RESOLVER_URL);
    const repoRoot = makeTmpDir('af-pr-none-nothrow');
    await expect(resolvePreviewConfig({ repoRoot })).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// AC2 — Configured path: preview_command + preview_url → web, source=configured
// ---------------------------------------------------------------------------
describe('AC2 — configured path: preview_command + preview_url → mode=web, source=configured', () => {
  it('returns mode=web, source=configured when preview_command + preview_url in PROJECT.md', async () => {
    const { resolvePreviewConfig } = await import(PREVIEW_RESOLVER_URL);
    const repoRoot = makeTmpDir('af-pr-cfg-url');

    writeProjectMd(repoRoot, {
      previewCommand: 'npm run dev',
      previewUrl: 'http://localhost:3000',
    });

    const result = await resolvePreviewConfig({ repoRoot });

    expect(result.mode).toBe('web');
    expect(result.source).toBe('configured');
    expect(result.command).toBe('npm run dev');
    expect(result.url).toBe('http://localhost:3000');
    expect(result.cwd).toBe(repoRoot);
  });
});

// ---------------------------------------------------------------------------
// AC2 — Configured path: preview_port (no preview_url) → web, url derived
// ---------------------------------------------------------------------------
describe('AC2 — configured path: preview_port without preview_url → mode=web, url derived', () => {
  it('derives url from preview_port when preview_url is absent', async () => {
    const { resolvePreviewConfig } = await import(PREVIEW_RESOLVER_URL);
    const repoRoot = makeTmpDir('af-pr-cfg-port');

    writeProjectMd(repoRoot, {
      previewCommand: 'npm run serve',
      previewPort: '8080',
    });

    const result = await resolvePreviewConfig({ repoRoot });

    expect(result.mode).toBe('web');
    expect(result.source).toBe('configured');
    expect(result.command).toBe('npm run serve');
    // url must include the port.
    expect(result.url).toMatch(/8080/);
    // url must be a valid http URL.
    expect(result.url).toMatch(/^http/);
  });
});

// ---------------------------------------------------------------------------
// AC2 — preview_mode explicit override (process) from frontmatter
// ---------------------------------------------------------------------------
describe('AC2 — configured path: explicit preview_mode=process overrides default web', () => {
  it('respects explicit preview_mode=process even with a url present', async () => {
    const { resolvePreviewConfig } = await import(PREVIEW_RESOLVER_URL);
    const repoRoot = makeTmpDir('af-pr-cfg-explicit-process');

    writeProjectMd(repoRoot, {
      previewCommand: 'npm run worker',
      previewUrl: 'http://localhost:9000',
      previewMode: 'process',
    });

    const result = await resolvePreviewConfig({ repoRoot });

    expect(result.mode).toBe('process');
    expect(result.source).toBe('configured');
    expect(result.command).toBe('npm run worker');
  });
});

// ---------------------------------------------------------------------------
// AC2 — preview_mode defaults to 'process' when command present but no url/port
// ---------------------------------------------------------------------------
describe('AC2 — configured path: preview_command only, no url/port → mode defaults to process', () => {
  it('defaults to mode=process when preview_command present but no url or port', async () => {
    const { resolvePreviewConfig } = await import(PREVIEW_RESOLVER_URL);
    const repoRoot = makeTmpDir('af-pr-cfg-cmd-only');

    writeProjectMd(repoRoot, {
      previewCommand: 'python manage.py runserver',
    });

    const result = await resolvePreviewConfig({ repoRoot });

    expect(result.mode).toBe('process');
    expect(result.source).toBe('configured');
    expect(result.command).toBe('python manage.py runserver');
    expect(result.url).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC2 + AC6 — Configured TAKES PRECEDENCE over inference:
//   PROJECT.md has preview block, package.json also has scripts.
//   Result must use the configured values, not the inferred ones.
// ---------------------------------------------------------------------------
describe('AC6 — configured > inferred precedence', () => {
  it('configured block wins over package.json scripts when both present', async () => {
    const { resolvePreviewConfig } = await import(PREVIEW_RESOLVER_URL);
    const repoRoot = makeTmpDir('af-pr-precedence');

    // Write both fixtures
    writeProjectMd(repoRoot, {
      previewCommand: 'npm run preview',
      previewUrl: 'http://localhost:4173',
    });
    writePackageJson(repoRoot, {
      dev: 'vite --port 5173',
      start: 'node server.js',
    });

    const result = await resolvePreviewConfig({ repoRoot });

    expect(result.source).toBe('configured');
    expect(result.command).toBe('npm run preview');
    expect(result.url).toBe('http://localhost:4173');
    // Must NOT have fallen through to the inferred dev script.
    expect(result.command).not.toBe('npm run dev');
  });
});

// ---------------------------------------------------------------------------
// AC3 — Inference: dev > start > serve precedence from package.json
// ---------------------------------------------------------------------------
describe('AC3 — inference: dev script wins over start when both present', () => {
  it('picks dev over start in scripts precedence', async () => {
    const { resolvePreviewConfig } = await import(PREVIEW_RESOLVER_URL);
    const repoRoot = makeTmpDir('af-pr-inf-dev-start');

    writePackageJson(repoRoot, {
      start: 'node server.js',
      dev: 'vite --port 5173',
      serve: 'serve -p 4000',
    });

    const result = await resolvePreviewConfig({ repoRoot });

    expect(result.source).toBe('inferred');
    // dev must win over start.
    expect(result.command).toContain('dev');
    expect(result.mode).toBe('web'); // --port 5173 is port-derivable
  });
});

describe('AC3 — inference: start wins over serve when dev absent', () => {
  it('picks start over serve when dev is not present', async () => {
    const { resolvePreviewConfig } = await import(PREVIEW_RESOLVER_URL);
    const repoRoot = makeTmpDir('af-pr-inf-start-serve');

    writePackageJson(repoRoot, {
      serve: 'serve -p 4000',
      start: 'node server.js',
    });

    const result = await resolvePreviewConfig({ repoRoot });

    expect(result.source).toBe('inferred');
    // start must win over serve.
    expect(result.command).toContain('start');
  });
});

describe('AC3 — inference: serve used when only serve present', () => {
  it('uses serve script when it is the only candidate', async () => {
    const { resolvePreviewConfig } = await import(PREVIEW_RESOLVER_URL);
    const repoRoot = makeTmpDir('af-pr-inf-serve-only');

    writePackageJson(repoRoot, {
      build: 'webpack --prod',
      serve: 'serve -p 8080 dist',
    });

    const result = await resolvePreviewConfig({ repoRoot });

    expect(result.source).toBe('inferred');
    expect(result.command).toContain('serve');
  });
});

// ---------------------------------------------------------------------------
// AC3 — Inference mode derivation: port-derivable script → mode=web
// ---------------------------------------------------------------------------
describe('AC3 — inference mode: port-derivable script → mode=web', () => {
  it('infers mode=web from --port flag in dev script', async () => {
    const { resolvePreviewConfig } = await import(PREVIEW_RESOLVER_URL);
    const repoRoot = makeTmpDir('af-pr-inf-mode-web-port');

    writePackageJson(repoRoot, {
      dev: 'vite --port 5173',
    });

    const result = await resolvePreviewConfig({ repoRoot });

    expect(result.source).toBe('inferred');
    expect(result.mode).toBe('web');
    // url must include the port.
    expect(result.url).toMatch(/5173/);
    expect(result.url).toMatch(/^http/);
  });

  it('infers mode=web from PORT=<N> env assignment in dev script', async () => {
    const { resolvePreviewConfig } = await import(PREVIEW_RESOLVER_URL);
    const repoRoot = makeTmpDir('af-pr-inf-mode-web-envport');

    writePackageJson(repoRoot, {
      dev: 'PORT=3000 node server.js',
    });

    const result = await resolvePreviewConfig({ repoRoot });

    expect(result.source).toBe('inferred');
    expect(result.mode).toBe('web');
    expect(result.url).toMatch(/3000/);
  });
});

// ---------------------------------------------------------------------------
// AC3 — Inference mode derivation: no port → mode=process
// ---------------------------------------------------------------------------
describe('AC3 — inference mode: no port derivable → mode=process', () => {
  it('infers mode=process when start script has no port pattern', async () => {
    const { resolvePreviewConfig } = await import(PREVIEW_RESOLVER_URL);
    const repoRoot = makeTmpDir('af-pr-inf-mode-process');

    writePackageJson(repoRoot, {
      start: 'node server.js',
    });

    const result = await resolvePreviewConfig({ repoRoot });

    expect(result.source).toBe('inferred');
    expect(result.mode).toBe('process');
    expect(result.url).toBeNull();
    expect(result.command).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC3 + AC4 — package.json exists but no candidate scripts → mode=none
// ---------------------------------------------------------------------------
describe('AC4 — package.json with no dev/start/serve scripts → mode=none', () => {
  it('returns none when package.json has no usable script and no PROJECT.md preview config', async () => {
    const { resolvePreviewConfig } = await import(PREVIEW_RESOLVER_URL);
    const repoRoot = makeTmpDir('af-pr-none-noscripts');

    writePackageJson(repoRoot, {
      build: 'tsc',
      test: 'vitest run',
    });

    const result = await resolvePreviewConfig({ repoRoot });

    expect(result.mode).toBe('none');
    expect(result.source).toBe('none');
    expect(result.command).toBeNull();
    expect(result.url).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC5 — Backward-compat: existing PROJECT.md with NO preview fields parses fine
//         and yields source=none (no package.json) or source=inferred (with scripts).
// ---------------------------------------------------------------------------
describe('AC5 — backward-compat: PROJECT.md without preview fields remains valid', () => {
  it('parses PROJECT.md with no preview fields and returns source=none when no package.json', async () => {
    const { resolvePreviewConfig } = await import(PREVIEW_RESOLVER_URL);
    const repoRoot = makeTmpDir('af-pr-compat-no-pkg');

    // Classic PROJECT.md with no preview fields at all.
    writeProjectMd(repoRoot, {}); // uses all defaults, no preview_* keys

    const result = await resolvePreviewConfig({ repoRoot });

    // Must not throw; must return a valid normalized shape.
    expect(result.mode).toBe('none');
    expect(result.source).toBe('none');
    expect(result.cwd).toBe(repoRoot);
  });

  it('parses PROJECT.md with no preview fields and falls back to inference when package.json has dev', async () => {
    const { resolvePreviewConfig } = await import(PREVIEW_RESOLVER_URL);
    const repoRoot = makeTmpDir('af-pr-compat-with-pkg');

    // Classic PROJECT.md with no preview fields.
    writeProjectMd(repoRoot, {});
    // But package.json has a dev script.
    writePackageJson(repoRoot, {
      dev: 'next dev -p 3000',
    });

    const result = await resolvePreviewConfig({ repoRoot });

    // Must fall through to inference, not throw.
    expect(result.source).toBe('inferred');
    expect(result.mode).toBe('web');
    expect(result.url).toMatch(/3000/);
  });
});

// ---------------------------------------------------------------------------
// AC1 — Shape contract: all five fields present in every non-trivial case
// ---------------------------------------------------------------------------
describe('AC1 — result shape always contains mode, command, cwd, url, source', () => {
  it('configured result has all five fields', async () => {
    const { resolvePreviewConfig } = await import(PREVIEW_RESOLVER_URL);
    const repoRoot = makeTmpDir('af-pr-shape-cfg');

    writeProjectMd(repoRoot, {
      previewCommand: 'npm start',
      previewUrl: 'http://localhost:4000',
    });

    const result = await resolvePreviewConfig({ repoRoot });

    expect(Object.prototype.hasOwnProperty.call(result, 'mode')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(result, 'command')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(result, 'cwd')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(result, 'url')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(result, 'source')).toBe(true);
  });

  it('inferred result has all five fields', async () => {
    const { resolvePreviewConfig } = await import(PREVIEW_RESOLVER_URL);
    const repoRoot = makeTmpDir('af-pr-shape-inf');

    writePackageJson(repoRoot, { dev: 'vite' });

    const result = await resolvePreviewConfig({ repoRoot });

    expect(Object.prototype.hasOwnProperty.call(result, 'mode')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(result, 'command')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(result, 'cwd')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(result, 'url')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(result, 'source')).toBe(true);
  });

  it('none result has all five fields', async () => {
    const { resolvePreviewConfig } = await import(PREVIEW_RESOLVER_URL);
    const repoRoot = makeTmpDir('af-pr-shape-none');

    const result = await resolvePreviewConfig({ repoRoot });

    expect(Object.prototype.hasOwnProperty.call(result, 'mode')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(result, 'command')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(result, 'cwd')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(result, 'url')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(result, 'source')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC2 — mode enum: only 'web', 'process', or 'none' are valid return values
// ---------------------------------------------------------------------------
describe('AC1 — mode field is one of: web | process | none', () => {
  const VALID_MODES = new Set(['web', 'process', 'none']);

  it('configured result mode is a valid enum value', async () => {
    const { resolvePreviewConfig } = await import(PREVIEW_RESOLVER_URL);
    const repoRoot = makeTmpDir('af-pr-mode-enum-cfg');
    writeProjectMd(repoRoot, { previewCommand: 'npm run dev' });
    const result = await resolvePreviewConfig({ repoRoot });
    expect(VALID_MODES.has(result.mode)).toBe(true);
  });

  it('inferred result mode is a valid enum value', async () => {
    const { resolvePreviewConfig } = await import(PREVIEW_RESOLVER_URL);
    const repoRoot = makeTmpDir('af-pr-mode-enum-inf');
    writePackageJson(repoRoot, { start: 'node index.js' });
    const result = await resolvePreviewConfig({ repoRoot });
    expect(VALID_MODES.has(result.mode)).toBe(true);
  });
});
