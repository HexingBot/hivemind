import { describe, it, expect } from 'vitest';
import { classifyPath, classifyFiles, contributionPlan } from '../src/upstream-classify.js';

describe('classifyPath', () => {
  it('marks the vendored Spine/Brain as hivemind', () => {
    for (const p of [
      'src/calibration.js', 'src/brain-client.js', 'src/manifest-policy.js', 'src/wisdom-sink.js',
      'bin/brain-launch.js', 'scripts/verify-manifests.mjs',
      'skills/impl-screen-specs/SKILL.md', '.claude/skills/manifest-verifier/SKILL.md',
      '.claude/shared/OBSERVABILITY.md', '.knowledge/derived/brain-contract.md', 'commands/brain.md',
    ]) {
      expect(classifyPath(p), p).toBe('hivemind');
    }
  });

  it('marks generic agent-framework files as engine', () => {
    for (const p of ['src/task-store.js', 'src/drive-loop.js', 'src/session-lock.js', 'bin/init.js', 'commands/loop.md', 'README.md']) {
      expect(classifyPath(p), p).toBe('engine');
    }
  });
});

describe('classifyFiles', () => {
  it('ENGINE when every path is generic', () => {
    expect(classifyFiles(['src/task-store.js', 'bin/init.js']).class).toBe('ENGINE');
  });
  it('HIVEMIND when every path is Spine/Brain', () => {
    expect(classifyFiles(['src/calibration.js', 'commands/brain.md']).class).toBe('HIVEMIND');
  });
  it('MIXED when both, splitting the files', () => {
    const r = classifyFiles(['src/task-store.js', 'src/brain-client.js']);
    expect(r.class).toBe('MIXED');
    expect(r.engine).toEqual(['src/task-store.js']);
    expect(r.hivemind).toEqual(['src/brain-client.js']);
  });
});

describe('contributionPlan', () => {
  it('buckets commits by contributability', () => {
    const plan = contributionPlan([
      { sha: 'a', subject: 'fix task-store', files: ['src/task-store.js'] },
      { sha: 'b', subject: 'add calibration', files: ['src/calibration.js'] },
      { sha: 'c', subject: 'brain + loop', files: ['src/brain-client.js', 'src/drive-loop.js'] },
    ]);
    expect(plan.contributable.map((c) => c.sha)).toEqual(['a']);
    expect(plan.blocked.map((c) => c.sha)).toEqual(['b']);
    expect(plan.needsSplit.map((c) => c.sha)).toEqual(['c']);
  });
});
