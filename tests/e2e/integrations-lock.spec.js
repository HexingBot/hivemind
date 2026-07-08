// tests/e2e/integrations-lock.spec.js
// TASK-116 — readLock/writeLock round-trip real disk I/O via atomicWriteFile.
// Pure ownership-edge logic (addOwner/dropOwner/isOrphaned) and schema shape
// are covered in tests/integrations-lock.spec.js (fast tier); this file only
// covers what actually touches the filesystem.
//
// AC1 — readLock()/writeLock() round-trip a lockfile and writeLock() uses
//   atomicWriteFile.

import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { PROD } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

// Spy on node:fs the same way tests/e2e/atomic-write.spec.js does, so we can
// assert writeLock actually goes through the atomicWriteFile temp+rename
// recipe rather than a plain writeFileSync.
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    openSync: vi.fn(real.openSync),
    writeSync: vi.fn(real.writeSync),
    fsyncSync: vi.fn(real.fsyncSync),
    closeSync: vi.fn(real.closeSync),
    renameSync: vi.fn(real.renameSync),
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

function makeEntry(owners) {
  return {
    kind: 'mcp',
    origin: 'github.com/example/mcp-firecrawl',
    pin: 'v2.0.0',
    integrity: 'sha256:' + 'b'.repeat(64),
    scope: 'project',
    owners,
    required: 'hard',
    installed_at: '2026-07-08T12:00:00Z',
    install_method: 'claude mcp add --scope project firecrawl ...',
    verified: 'unsigned',
  };
}

describe('AC1 — readLock/writeLock round-trip', () => {
  it('round_trips_a_lockfile_through_atomicWriteFile', async () => {
    const fs = await import('node:fs');
    const { readLock, writeLock } = await import(PROD.integrationsLock);

    const repoDir = makeTmpDir('af-lock');
    const target = join(repoDir, 'integrations.lock.json');
    const lock = {
      schema_version: 1,
      resources: { 'mcp:firecrawl': makeEntry(['design-power@0.1.0']) },
    };

    await writeLock(target, lock);

    // writeLock used atomicWriteFile: a sibling tmp file was opened with
    // O_CREAT|O_EXCL and then renamed onto the target (never a direct write).
    const tmpOpen = fs.openSync.mock.calls.find(([p, flags]) =>
      String(p).startsWith(target + '.tmp.') &&
      typeof flags === 'number' &&
      (flags & fs.constants.O_EXCL) !== 0 &&
      (flags & fs.constants.O_CREAT) !== 0,
    );
    expect(tmpOpen, 'expected O_CREAT|O_EXCL open on a sibling tmp file').toBeDefined();
    const tmpPath = String(tmpOpen[0]);
    const renameTmpToTarget = fs.renameSync.mock.calls.find(
      ([src, dst]) => src === tmpPath && dst === target,
    );
    expect(renameTmpToTarget, 'rename(tmp, target) must have been called').toBeDefined();

    expect(existsSync(target)).toBe(true);
    const onDisk = JSON.parse(readFileSync(target, 'utf8'));
    expect(onDisk).toEqual(lock);

    const roundTripped = await readLock(target);
    expect(roundTripped).toEqual(lock);
  });

  it('writeLock_rejects_a_schema_invalid_payload_before_touching_disk', async () => {
    const { writeLock } = await import(PROD.integrationsLock);

    const repoDir = makeTmpDir('af-lock-invalid');
    const target = join(repoDir, 'integrations.lock.json');
    const badLock = { schema_version: 1, resources: { 'mcp:x': { kind: 'mcp' } } };

    await expect(writeLock(target, badLock)).rejects.toThrow();
    expect(existsSync(target)).toBe(false);
  });
});
