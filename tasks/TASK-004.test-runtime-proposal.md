# TASK-004 — Test Runtime Proposal

**Status:** awaiting human approval
**Author:** Developer subagent (TEST-mode, pre-write)
**Date:** 2026-05-24

## 1. Recommendation

**Node.js (≥ 20) + Vitest**, with `ajv` + `ajv-formats` for JSON Schema validation and `gray-matter` for YAML frontmatter parsing.

Node 22.19.0 is already installed on this machine (confirmed via `node --version`). No other runtime needs to be installed.

## 2. Rationale (vs. alternatives)

The TASK-004 acceptance criteria revolve around three things: (a) the **atomic temp+rename write recipe**, (b) **cross-machine bundle round-trip** simulated via a different working directory, and (c) **JSON Schema + YAML frontmatter validation**. The runtime needs to be ergonomic for all three on Windows.

### Axis-by-axis comparison

| Axis | Node + Vitest (pick) | Python + pytest | PowerShell + Pester | Plain shell + custom runner |
|------|----------------------|-----------------|---------------------|-----------------------------|
| **Windows atomic-write testability** | Native `fs.rename` is the *exact* API the production code under test will use. Vitest's `vi.mock('node:fs')` lets us assert the call order `open(O_EXCL) → write → fsync → close → rename` without going to disk. EBUSY retry simulation is a one-liner: `.mockRejectedValueOnce({ code: 'EBUSY' })`. | Would test `os.rename` / `os.replace`, which is **not** the API the production code uses — wrong layer. Round-trip integration tests still work, but the unit-level mock of the recipe loses fidelity. | Pester 5.x's `Mock` works against PowerShell cmdlets (`Move-Item`, `Set-Content`). Same wrong-layer problem as Python unless the production code is itself PowerShell. | Custom; everything has to be written from scratch including the mock infrastructure. High cost, low value. |
| **Cross-machine round-trip ergonomics (AC12)** | Vitest test fns receive context; `cwd` is just a parameter to a helper. Spawning a child Node process with `cwd: tmpDirB` via `node:child_process` is one line — perfect for the "different machine" simulation. | Pytest's `tmp_path` + `monkeypatch.chdir` is idiomatic. Equivalent ergonomics. | Pester's `Push-Location` / `Pop-Location` works but the convention is weaker; spawning a sub-shell is heavier. | Doable, painful. |
| **Bootstrap cost** | Node 22 already installed. `npm install --save-dev vitest ajv ajv-formats gray-matter` is one command. ~80 MB `node_modules`. | Python 3.7 installed, but 3.7 is **EOL** (June 2023). pytest works on 3.7 but `jsonschema` ≥ 4.18 requires 3.8+. User would need to install Python ≥ 3.10. | PowerShell 5.1 installed, but ships with **Pester 3.4.0** which has a fundamentally different API from Pester 5. Pester 5 install: `Install-Module -Force -SkipPublisherCheck`. Plus an AJV-equivalent (`Test-Json` only does basic checks). | Always available, but reinvents everything. |
| **Maintenance/familiarity** | TypeScript+Node is the lingua franca of the Claude Agent SDK ecosystem (per CLAUDE.md, "built on the Claude Agent SDK"). Future contributors and Claude itself read this idiomatically. | Reasonable, but introduces a second language. The eventual production code (lifecycle commands) is most naturally Node given the SDK context. | Niche outside Windows admin contexts. Splits the codebase: tests in PowerShell, production in Node. | None. |
| **JSON Schema support** | `ajv` (de facto standard, Draft 2020-12, format validation via `ajv-formats`). Fully covers `state/session.json`, bundle `manifest.json`, and `knowledge/schema.json`. | `jsonschema` library. Comparable. Requires Python 3.8+. | `Test-Json` is shallow (no Draft 2020-12, no `format` validation). Would need `Microsoft.PowerShell.Utility` plus a third-party module. Weakest of the four. | Would need to shell out. |
| **YAML frontmatter parsing** | `gray-matter` is the Markdown+frontmatter standard library. Battle-tested. | `python-frontmatter`. Comparable. | `powershell-yaml` module — works, less common. | Reinvent. |

### The single decisive factor

The atomic-write recipe is the **load-bearing invariant of TASK-004**, and Node + Vitest is the only stack on this list that lets me unit-test it at the exact same API layer the production code will use. Every other stack forces me into integration-only verification of the recipe (write to disk, observe outcome) and loses the ability to assert call ordering. Given that AC4 and AC5 (idempotency) hinge on call-order semantics, this is non-negotiable.

## 3. Directory layout

```
hivemind/
├── package.json                              # scripts.test → "vitest run"
├── vitest.config.ts                          # minimal; default jsdom-off, node env
├── tests/
│   ├── helpers/
│   │   ├── fixtures.ts                       # makeBundle(), makeRepoSkeleton(cwd)
│   │   ├── tmpRepo.ts                        # spin up tmp working dir with state/ + tasks/
│   │   └── fsMocks.ts                        # vi.mock('node:fs') helpers (EBUSY, EXDEV, etc.)
│   ├── pointer.spec.ts                       # tests #1, #23
│   ├── bundle-shape.spec.ts                  # tests #2, #4, #5
│   ├── atomic-write.spec.ts                  # tests #6, #8        ← centerpiece
│   ├── lifecycle.spec.ts                     # tests #7, #9, #10, #11, #12
│   ├── summary.spec.ts                       # tests #13, #14
│   ├── inspection.spec.ts                    # tests #15, #16
│   ├── knowledge-files.spec.ts               # tests #17, #18, #19, #26
│   ├── knowledge-lookup.spec.ts              # tests #20, #21, #22
│   ├── docs.spec.ts                          # tests #23, #24
│   └── round-trip.spec.ts                    # test #25 (cross-machine)
└── (production code, when IMPL mode runs)
```

File names use Vitest's `*.spec.ts` convention; test names inside each file match research §H verbatim (`pause_atomic_write_temp_then_rename`, etc.). One `describe` per file groups the concern.

## 4. Bootstrap commands

To be run once by the human (or Orchestrator after approval):

```bash
# from repo root
npm init -y
npm pkg set type="module"
npm pkg set scripts.test="vitest run"
npm pkg set scripts.test:watch="vitest"
npm install --save-dev \
  vitest@^2 \
  typescript@^5 \
  @types/node@^22 \
  ajv@^8 \
  ajv-formats@^3 \
  gray-matter@^4
npx tsc --init --module nodenext --moduleResolution nodenext --target es2022 --strict
```

Node **≥ 20** is required (native `fs.cp` for bundle copy in round-trip tests, `node --test` parity, and Vitest 2.x targets Node 18+). The installed `v22.19.0` is well above that line.

`.gitignore` already covers `node_modules/` per the bootstrap notes; verify before committing.

## 5. Test command

Single command, runnable from repo root:

```bash
npm test
```

Resolves to `vitest run` (one-shot, non-watch, CI-friendly exit code). The Reviewer subagent and any future CI hook target this exact command. `npm run test:watch` is provided for developer iteration but is not part of the contract.

## 6. Known limitations

1. **Real `fsync` on Windows is unobservable.** Node's `fs.fsyncSync` calls `FlushFileBuffers` but does not expose a verification hook. Our `atomic-write.spec.ts` will assert that `fsyncSync` is **called** (via mock), not that the bytes actually hit non-volatile storage. This matches the research doc's §C note that fsync semantics on Windows are best-effort.
2. **Antivirus EBUSY is simulated, not reproduced.** We mock `rename` to reject with `{ code: 'EBUSY' }` once and assert the retry path runs. We do not actually invoke Windows Defender to hold a handle. Trade-off: deterministic tests vs. true end-to-end fidelity.
3. **The non-atomic-rename window on Windows** (target unlinked before tmp moved into place) is **simulated** by mocking the unlink call to throw between unlink and rename, then asserting the recovery sweep promotes the tmp file. We cannot induce the actual kernel-level race; we test that our code handles the observable outcome.
4. **Long-path testing requires a long working directory.** We will not test the >260-char path scenario in CI — it would need the test runner itself to live deep in a path. Documented in §I-3 of research; flagged for manual verification.
5. **Round-trip test ignores file-attribute portability.** `fs.cp` preserves mtime but not ACLs / NTFS alternate data streams. If a future requirement says "bundle ACLs must travel" the test won't catch it; the current acceptance criteria do not require this.
6. **Concurrent-writer scenarios are out of scope** per the resolved design question #1 (no lockfile at v1). No tests attempt to write the same bundle from two processes simultaneously.

## 7. First failing test stub — test #6 (`pause_atomic_write_temp_then_rename`)

Below is the idiomatic shape this stack will produce. **This is illustrative only and is NOT written to disk in this run.**

```ts
// tests/atomic-write.spec.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Production module — does not exist yet (this is the failing-for-the-right-reason point).
import { pauseSession } from '../src/lifecycle.js';

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  return {
    ...real,
    openSync:    vi.fn(real.openSync),
    writeSync:   vi.fn(real.writeSync),
    fsyncSync:   vi.fn(real.fsyncSync),
    closeSync:   vi.fn(real.closeSync),
    renameSync:  vi.fn(real.renameSync),
    writeFileSync: vi.fn(() => {
      throw new Error('writeFileSync must NOT be called directly on session.json');
    }),
  };
});

describe('atomic-write recipe — pause', () => {
  let repoDir: string;
  let bundleDir: string;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'af-test-'));
    bundleDir = join(repoDir, 'state', 'sessions', '20260524T120000Z-deadbeef');
    // seed an active bundle on disk (helper would be in tests/helpers/fixtures.ts)
    seedActiveBundle(bundleDir);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('pause_atomic_write_temp_then_rename', async () => {
    const fs = await import('node:fs');
    const target = join(bundleDir, 'session.json');

    await pauseSession({
      repoRoot: repoDir,
      handoffSummary: 'mid-task pause',
      nextAction: 'resume tomorrow',
    });

    // 1. A tmp file in the SAME directory as session.json was opened with O_EXCL.
    const openCalls = (fs.openSync as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const tmpOpen = openCalls.find(([path, flags]) =>
      String(path).startsWith(target + '.tmp.') &&
      typeof flags === 'number' &&
      (flags & fs.constants.O_EXCL) !== 0 &&
      (flags & fs.constants.O_CREAT) !== 0,
    );
    expect(tmpOpen, 'expected an O_EXCL|O_CREAT open on a sibling tmp file').toBeDefined();
    const tmpPath = String(tmpOpen![0]);

    // 2. fsync was called on the tmp fd BEFORE rename.
    const fsyncOrder = (fs.fsyncSync as unknown as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    const renameOrder = (fs.renameSync as unknown as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(fsyncOrder).toBeLessThan(renameOrder);

    // 3. rename moved tmp → target (not the other direction; not a direct write).
    expect(fs.renameSync).toHaveBeenCalledWith(tmpPath, target);

    // 4. No direct writeFileSync on session.json (the mock above would have thrown).
    //    Implicit — if pauseSession got here without throwing, this is satisfied.

    // 5. Post-condition: target contains lifecycle_state="paused" and the new handoff_summary.
    const written = JSON.parse(readFileSync(target, 'utf8'));
    expect(written.lifecycle_state).toBe('paused');
    expect(written.handoff_summary).toBe('mid-task pause');
  });
});

function seedActiveBundle(dir: string) {
  // helper body lives in tests/helpers/fixtures.ts in the real suite
  throw new Error('seedActiveBundle: NOT IMPLEMENTED (will live in tests/helpers/fixtures.ts)');
}
```

This test fails for the **right reason** in IMPL mode's starting state: `pauseSession` does not exist in `../src/lifecycle.js`, so the import resolves to nothing. Once IMPL writes the function, the same test exercises the call-order invariant.

## 8. Concerns (not changes to AC — surfaced for the human)

1. **AC11 ("CLAUDE.md and state/README.md are updated")** is testable only as a *string-presence* assertion (tests #23, #24 in research §H). It does not verify that the text is correct or up-to-date with the implementation. The Reviewer subagent will need to spot-check this manually.
2. **AC9 ("Researcher consults knowledge/ before web research")** test (#20) verifies the contract document mentions the lookup; it does **not** prove the live Researcher subagent obeys it at runtime. True behavioral testing would require spawning the subagent and observing its tool calls, which is out of scope for this test layer. This is a known limit — flagged in research §H but worth re-flagging.
3. **The transcript directory on Windows is still TBD** (research §I-3, ticket comment #3). Tests #4 and #5 will need a configurable transcript-source path. I'll wire that as an env var (`CLAUDE_CODE_TRANSCRIPT_DIR`) the production code reads, with the tests pointing it at a fixture directory. The "discover the real path" work remains an implementation TODO and is not blocked by the runtime choice.
4. **Python 3.7 on this machine is EOL.** Calling it out for awareness even though the recommendation is Node — if at any point we want to use a Python helper script anywhere in the framework, it should be a fresh install (≥ 3.10).
5. **Pester 3.4 (shipped with Windows PowerShell 5.1) is API-incompatible with Pester 5.** If the human ever wants to revisit PowerShell-native testing, factor in a forced Pester 5 install per project.
