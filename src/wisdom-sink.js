// wisdom-sink — persist the brain's generated wisdom artifacts (Phase 5). A generated SKILL.md
// lands in .claude/skills/<slug>/ so agents can load it; a lesson lands in knowledge/lessons/.
// `persistWisdom` ties the brain-client generation to disk and degrades gracefully: when the brain
// is unavailable nothing is generated, so nothing is written and the caller is told why.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function slugify(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unnamed';
}

/** Write a generated SKILL.md into .claude/skills/<slug>/SKILL.md. */
export async function writeSkill({ repoRoot, name, skillMd, fs = { mkdir, writeFile } }) {
  const slug = slugify(name);
  const dir = join(repoRoot, '.claude', 'skills', slug);
  await fs.mkdir(dir, { recursive: true });
  const path = join(dir, 'SKILL.md');
  await fs.writeFile(path, skillMd);
  return { path, slug };
}

/** Write a generated lesson into knowledge/lessons/<slug>.md. */
export async function writeLesson({ repoRoot, name, lessonMd, fs = { mkdir, writeFile } }) {
  const slug = slugify(name);
  const dir = join(repoRoot, 'knowledge', 'lessons');
  await fs.mkdir(dir, { recursive: true });
  const path = join(dir, `${slug}.md`);
  await fs.writeFile(path, lessonMd);
  return { path, slug };
}

/**
 * Generate a SKILL.md (and, when a mission is given, a lesson) for an entity via the brain, and
 * persist them. Returns per-artifact status; when the brain is down, `persisted: false` with the
 * reason and nothing is written.
 */
export async function persistWisdom({ brain, repoRoot, name, mission, type, fs }) {
  const out = {};

  const skill = await brain.generateSkill({ name, type });
  out.skill = skill.source === 'brain'
    ? { persisted: true, ...(await writeSkill({ repoRoot, name: skill.name || name, skillMd: skill.skill_md, fs })) }
    : { persisted: false, reason: skill.source };

  if (mission) {
    const lesson = await brain.generateLesson({ name, mission, type });
    out.lesson = lesson.source === 'brain'
      ? { persisted: true, ...(await writeLesson({ repoRoot, name: lesson.name || name, lessonMd: lesson.lesson_md, fs })) }
      : { persisted: false, reason: lesson.source };
  }

  return out;
}
