// tests/e2e/verification-tier.spec.js
// TASK-028 — tiered verification policy + scaled per-ticket gate.
//
// Acceptance criteria covered:
//   AC1 — tasks/schema.json gains optional verification_tier enum
//          [tdd, tests-after, uat-only]; absent is still valid; invalid value
//          is rejected; additionalProperties: false means the field MUST be
//          declared in the schema or a file carrying it fails ajv validation
//          (that is the current red state).
//   AC1 (createTask) — createTask persists verification_tier when given; omits
//          it when not given; rejects an invalid tier value.
//   AC5 (CLI) — bin/new-task.js --tier <value> lands in the created JSON;
//          --tier bogus throws.
//   AC5 (MCP) — create_task via InMemoryTransport persists verification_tier.
//
// Red reasons per group:
//   schema-ajv group : tasks/schema.json has no `verification_tier` property and
//     `additionalProperties: false`, so a task carrying the field currently fails
//     ajv validation. The "absent field still valid" test will PASS today (current
//     schema validates tasks without the field) — but that is deliberate: only the
//     "with valid tier" and "with invalid tier" tests fail until impl lands.
//   createTask group  : createTask does not accept/persist verification_tier yet;
//     passing it produces a schema-validation failure (additionalProperties).
//   CLI group         : bin/new-task.js has no --tier flag; it throws "unknown flag".
//   MCP group         : create_task input schema does not include verification_tier;
//     zod/SDK strips or rejects the extra field.

import {
  describe, it, expect, beforeEach, afterEach, afterAll,
} from 'vitest';
import {
  readFileSync, mkdtempSync, rmSync, existsSync, readdirSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { PROD, makeRepoSkeleton } from '../helpers/fixtures.js';
import { makeTmpDir, cleanupAll } from '../helpers/tmpRepo.js';

afterAll(cleanupAll);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const __thisDir = dirname(fileURLToPath(import.meta.url));
const __repoRoot = join(__thisDir, '..', '..');
const SCHEMA_PATH = join(__repoRoot, 'tasks', 'schema.json');

function loadSchema() {
  return JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
}

function makeAjv() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv;
}

function readTaskFile(repoDir, key) {
  return JSON.parse(readFileSync(join(repoDir, 'tasks', `${key}.json`), 'utf8'));
}

/** A minimal valid task payload without verification_tier */
function baseTask(overrides = {}) {
  return {
    key: 'TASK-001',
    title: 'A test task',
    description: 'For tier-schema tests.',
    acceptance_criteria: ['works'],
    status: 'todo',
    priority: 'medium',
    labels: [],
    assignee: null,
    depends_on: [],
    linked_commits: [],
    linked_prs: [],
    comments: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    jira_key: null,
    ...overrides,
  };
}

// Tool results from MCP come as { content: [{ type:'text', text:'<json>' }] }
function parse(result) {
  return JSON.parse(result.content[0].text);
}

// ===========================================================================
// AC1 — tasks/schema.json round-trip via ajv
// ===========================================================================
describe('AC1 — schema: verification_tier field', () => {
  // Collapse: three near-identical per-enum tests -> one it.each (TASK-033 L7).
  it.each(['tdd', 'tests-after', 'uat-only'])(
    'schema_accepts_a_task_with_a_valid_tier_%s',
    (tier) => {
      const schema = loadSchema();
      const ajv = makeAjv();
      const validate = ajv.compile(schema);

      const task = baseTask({ verification_tier: tier });
      const ok = validate(task);
      expect(
        ok,
        `schema must accept verification_tier: "${tier}" — errors: ` +
          JSON.stringify(validate.errors),
      ).toBe(true);
    },
  );

  it('schema_still_accepts_a_task_without_verification_tier', () => {
    // Absent field must remain valid (backward-compatible, absent == tdd semantics).
    const schema = loadSchema();
    const ajv = makeAjv();
    const validate = ajv.compile(schema);

    const task = baseTask(); // no verification_tier key
    const ok = validate(task);
    expect(
      ok,
      'schema must still accept tasks without verification_tier — ' +
        JSON.stringify(validate.errors),
    ).toBe(true);
  });

  it('schema_rejects_an_invalid_tier_value', () => {
    // "invalid" is not in the enum — must be rejected.
    const schema = loadSchema();
    const ajv = makeAjv();
    const validate = ajv.compile(schema);

    const task = baseTask({ verification_tier: 'invalid-value' });
    const ok = validate(task);
    expect(ok, 'schema must reject verification_tier: "invalid-value"').toBe(false);
  });
});

// ===========================================================================
// AC1 (createTask) — createTask persists / omits / rejects verification_tier
// ===========================================================================
describe('AC1 — createTask: verification_tier field', () => {
  it('createTask_persists_verification_tier_when_provided', async () => {
    // RED: createTask does not forward verification_tier; the extra field causes
    // schema validation to throw ("additionalProperties" until schema is updated,
    // then task is written without the field until impl is added).
    const { createTask } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-vt-create-with-tier');
    makeRepoSkeleton(repoDir, {});

    const { key } = await createTask({
      repoRoot: repoDir,
      title: 'Tiered task',
      description: 'Has a tier.',
      acceptance_criteria: ['tier is persisted'],
      priority: 'medium',
      verification_tier: 'tests-after',
      now: () => '2026-09-10T12:00:00Z',
    });

    const written = readTaskFile(repoDir, key);
    expect(written.verification_tier).toBe('tests-after');
  });

  it('createTask_omits_verification_tier_when_not_provided', async () => {
    // When the caller does not pass verification_tier, the key must be absent
    // (not null, not a default string — absent entirely).
    const { createTask } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-vt-create-no-tier');
    makeRepoSkeleton(repoDir, {});

    const { key } = await createTask({
      repoRoot: repoDir,
      title: 'No-tier task',
      description: 'No tier supplied.',
      acceptance_criteria: ['tier is absent'],
      priority: 'low',
      now: () => '2026-09-10T12:00:00Z',
    });

    const written = readTaskFile(repoDir, key);
    expect(
      Object.prototype.hasOwnProperty.call(written, 'verification_tier'),
      'verification_tier must be absent when not provided',
    ).toBe(false);
  });

  it('createTask_rejects_an_invalid_tier', async () => {
    // RED: createTask does not validate the tier at all yet.
    // STRENGTHENED (authorized TASK-028 review fix M2): after the rejection,
    // assert the tmp repo's tasks/ gained no new TASK-*.json and that
    // tasks/index.json is unchanged (snapshot bytes before, compare after —
    // byte-identity idiom from tests/e2e/task-store-hardening.spec.js).
    const { createTask } = await import(PROD.taskStore);

    const repoDir = makeTmpDir('af-vt-create-bad-tier');
    makeRepoSkeleton(repoDir, {});

    // Snapshot tasks/ before the rejected call.
    const tasksDir = join(repoDir, 'tasks');
    const beforeFiles = readdirSync(tasksDir).sort();
    const indexPath = join(tasksDir, 'index.json');
    const indexBefore = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : null;

    await expect(
      createTask({
        repoRoot: repoDir,
        title: 'Bad tier',
        description: 'Invalid tier value.',
        acceptance_criteria: ['tier is rejected'],
        priority: 'medium',
        verification_tier: 'sprint', // not in enum
        now: () => '2026-09-10T12:00:00Z',
      }),
    ).rejects.toThrow(/tier/i);

    // No new TASK-*.json was created.
    const afterFiles = readdirSync(tasksDir).sort();
    expect(afterFiles, 'tasks/ must not gain any new files on a rejected tier').toEqual(beforeFiles);

    // index.json is byte-identical (or still absent if it was absent before).
    const indexAfter = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : null;
    expect(indexAfter, 'tasks/index.json must not be written on a rejected tier').toBe(indexBefore);
  });
});

// ===========================================================================
// AC5 (CLI) — bin/new-task.js --tier flag
// ===========================================================================
describe('AC5 — CLI: --tier flag', () => {
  it('tier_flag_lands_in_created_task_json', async () => {
    // RED: parseArgs throws "unknown flag: --tier" — the flag doesn't exist yet.
    const { runCli } = await import(PROD.newTaskCli);

    const repoDir = makeTmpDir('af-vt-cli-tier');
    makeRepoSkeleton(repoDir, {});

    const result = await runCli({
      argv: [
        '--title', 'Tiered CLI task',
        '--description', 'Set via flag.',
        '--ac', 'tier persisted',
        '--priority', 'medium',
        '--tier', 'tests-after',
      ],
      prompter: async () => { throw new Error('prompter must not be called'); },
      repoRoot: repoDir,
      now: () => '2026-09-10T12:00:00Z',
    });

    const written = readTaskFile(repoDir, result.key);
    expect(written.verification_tier).toBe('tests-after');
  });

  it('bogus_tier_flag_throws', async () => {
    // RED: --tier is unknown today → throws "unknown flag: --tier".
    // After impl lands the message must relate to tier validation, not "unknown flag".
    // We only assert a throw of any kind here — the right reason is that the
    // impl validates the enum and throws before writing.
    const { runCli } = await import(PROD.newTaskCli);

    const repoDir = makeTmpDir('af-vt-cli-bad-tier');
    makeRepoSkeleton(repoDir, {});

    await expect(
      runCli({
        argv: [
          '--title', 'Bad tier task',
          '--description', 'Invalid tier.',
          '--ac', 'bogus',
          '--priority', 'low',
          '--tier', 'bogus',
        ],
        prompter: async () => { throw new Error('prompter must not be called'); },
        repoRoot: repoDir,
        now: () => '2026-09-10T12:00:00Z',
      }),
    ).rejects.toThrow();
  });
});

// ===========================================================================
// AC5 (MCP) — create_task via InMemoryTransport persists verification_tier
// ===========================================================================
describe('AC5 — MCP: create_task verification_tier round-trip', () => {
  let repoRoot;
  let client;
  let server;

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'mcp-vt-'));
    makeRepoSkeleton(repoRoot);

    const { createServer } = await import('../../src/mcp-server.js');
    server = createServer({ repoRoot });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'task-028-test', version: '0.0.0' });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
  });

  afterEach(async () => {
    if (client) await client.close();
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
  });

  it('create_task_with_verification_tier_persists_it', async () => {
    // RED: the create_task tool's zod inputSchema does not include verification_tier;
    // the SDK will strip the extra field (zod passthrough is not set) or reject it,
    // so the written task will lack verification_tier.
    const created = parse(await client.callTool({
      name: 'create_task',
      arguments: {
        title: 'MCP tiered task',
        description: 'Created via MCP with a tier.',
        acceptance_criteria: ['verification_tier persisted via MCP'],
        priority: 'medium',
        verification_tier: 'tdd',
      },
    }));
    expect(created.key).toMatch(/^TASK-\d{3,}$/);

    // Read the written file directly to check the persisted tier.
    const written = JSON.parse(
      readFileSync(join(repoRoot, 'tasks', `${created.key}.json`), 'utf8'),
    );
    expect(written.verification_tier).toBe('tdd');
  });
});
