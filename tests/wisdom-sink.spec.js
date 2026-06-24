import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { slugify, writeSkill, writeLesson, persistWisdom } from '../src/wisdom-sink.js';

const dirs = [];
function tmp() { const d = mkdtempSync(join(tmpdir(), 'wisdom-')); dirs.push(d); return d; }
afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });

describe('slugify', () => {
  it('kebab-cases a name', () => {
    expect(slugify('React Query')).toBe('react-query');
    expect(slugify('  C++ / weirdness!! ')).toBe('c-weirdness');
  });
});

describe('writeSkill / writeLesson', () => {
  it('writes a SKILL.md under .claude/skills/<slug>/', async () => {
    const repo = tmp();
    const { path } = await writeSkill({ repoRoot: repo, name: 'React Query', skillMd: '# RQ\n' });
    expect(path).toBe(join(repo, '.claude', 'skills', 'react-query', 'SKILL.md'));
    expect(readFileSync(path, 'utf8')).toBe('# RQ\n');
  });

  it('writes a lesson under knowledge/lessons/<slug>.md', async () => {
    const repo = tmp();
    const { path } = await writeLesson({ repoRoot: repo, name: 'React Query', lessonMd: '# lesson\n' });
    expect(path).toBe(join(repo, 'knowledge', 'lessons', 'react-query.md'));
    expect(readFileSync(path, 'utf8')).toBe('# lesson\n');
  });
});

describe('persistWisdom', () => {
  it('generates + persists both when the brain is up', async () => {
    const repo = tmp();
    const brain = {
      generateSkill: async () => ({ source: 'brain', name: 'React Query', skill_md: '# skill\n' }),
      generateLesson: async () => ({ source: 'brain', name: 'React Query', lesson_md: '# lesson\n' }),
    };
    const out = await persistWisdom({ brain, repoRoot: repo, name: 'React Query', mission: 'learn' });
    expect(out.skill.persisted).toBe(true);
    expect(out.lesson.persisted).toBe(true);
    expect(existsSync(join(repo, '.claude', 'skills', 'react-query', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(repo, 'knowledge', 'lessons', 'react-query.md'))).toBe(true);
  });

  it('skips persistence (no files) when the brain is unavailable', async () => {
    const repo = tmp();
    const brain = {
      generateSkill: async () => ({ source: 'unavailable', skill_md: null }),
      generateLesson: async () => ({ source: 'unavailable', lesson_md: null }),
    };
    const out = await persistWisdom({ brain, repoRoot: repo, name: 'React Query', mission: 'learn' });
    expect(out.skill).toEqual({ persisted: false, reason: 'unavailable' });
    expect(out.lesson).toEqual({ persisted: false, reason: 'unavailable' });
    expect(existsSync(join(repo, '.claude', 'skills', 'react-query'))).toBe(false);
  });

  it('skips the lesson when no mission is given', async () => {
    const repo = tmp();
    const brain = {
      generateSkill: async () => ({ source: 'brain', name: 'X', skill_md: '# x\n' }),
      generateLesson: async () => { throw new Error('should not be called'); },
    };
    const out = await persistWisdom({ brain, repoRoot: repo, name: 'X' });
    expect(out.skill.persisted).toBe(true);
    expect(out.lesson).toBeUndefined();
  });
});
