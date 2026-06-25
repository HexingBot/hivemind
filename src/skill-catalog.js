// src/skill-catalog.js
// TASK-053 — Vetted skill catalog for the web console skill-buttons panel.
//
// listSkills({ repoRoot }) → array of { id, label, description, invocation }
//
// The catalog is derived from two sources:
//   1. commands/*.md files that opt in with `panel_safe: true` in frontmatter.
//      Commands WITHOUT panel_safe are excluded — clicking a button runs
//      immediately, so only safe, non-destructive commands should appear.
//      The catalog auto-grows: any future command with panel_safe: true shows up
//      without code changes.
//   2. A curated SAFE-ACTIONS list of plain-English conversational prompts for
//      non-technical users. These never invoke destructive ops.
//
// Stable order: opt-in commands sorted by id (ascending), then curated entries.
// De-dup by id: curated wins over a commands/-derived entry with the same id.
//
// resolveSkillInvocation(repoRoot, id) → invocation string | null
//   Returns the canonical invocation for a known skill id, or null for an
//   unknown id. Used by the route to map client id → invocation and reject
//   unknowns before any send() call.
//
// NO new npm dependencies — frontmatter is parsed with the same minimal
// regex-based approach used by the in-house parser in src/project-md.js.

import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';

// ---------------------------------------------------------------------------
// Curated safe-actions allowlist — always appended after the opt-in commands.
// All entries are plain-English orchestrator prompts; none trigger destructive
// ops. Order here is the display order for the curated section.
// ---------------------------------------------------------------------------
const CURATED_SKILLS = [
  {
    id: 'help',
    label: 'Help',
    description: 'Ask the orchestrator what it can do for you',
    invocation: 'What can you help me with right now? List the actions and tickets available.',
  },
  {
    id: 'status',
    label: 'Status',
    description: 'Get a short status of current work',
    invocation: 'Give me a short status: the active task, what is in progress, and what is next.',
  },
  {
    id: 'next',
    label: "What's next",
    description: 'Ask what to work on next',
    invocation: 'What should I work on next? Suggest the next ticket and why.',
  },
  {
    id: 'new-task',
    label: 'New task',
    description: 'Start creating a new task by chatting',
    invocation: 'I want to create a new task. Ask me what I need, then create the ticket.',
  },
];

// ---------------------------------------------------------------------------
// Internal: derive a human-readable Title Case label from a kebab-case id.
// e.g. "task-status" → "Task Status", "apply-workflows" → "Apply Workflows"
// ---------------------------------------------------------------------------
function deriveLabel(id) {
  return id
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// ---------------------------------------------------------------------------
// Internal: parse minimal YAML frontmatter from a commands/*.md file.
// Returns an object of scalar key→value pairs found between the --- delimiters.
// Returns {} if the file has no frontmatter or it can't be parsed.
// ---------------------------------------------------------------------------
function parseFrontmatterFields(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') return {};

  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') { closeIdx = i; break; }
  }
  if (closeIdx === -1) return {};

  const out = {};
  for (let i = 1; i < closeIdx; i++) {
    const m = lines[i].match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public: listSkills({ repoRoot }) → [{ id, label, description, invocation }]
// ---------------------------------------------------------------------------
export async function listSkills({ repoRoot } = {}) {
  const commandsDir = repoRoot ? join(repoRoot, 'commands') : null;
  const commandSkills = [];

  if (commandsDir && existsSync(commandsDir)) {
    let entries;
    try {
      entries = await readdir(commandsDir);
    } catch {
      entries = [];
    }

    const mdFiles = entries
      .filter((name) => name.endsWith('.md'))
      .sort(); // sort alphabetically → stable sort by id

    for (const filename of mdFiles) {
      const filePath = join(commandsDir, filename);
      let text;
      try {
        text = await readFile(filePath, 'utf8');
      } catch {
        continue; // unreadable — skip
      }

      const fm = parseFrontmatterFields(text);

      // Opt-in gate: only include commands that declare panel_safe: true.
      if (fm.panel_safe !== 'true') continue;

      const id = basename(filename, '.md');
      const description = fm.description || `Run /${id}`;
      const invocation = `/hivemind:${id}`;
      const label = deriveLabel(id);

      commandSkills.push({ id, label, description, invocation });
    }
  }

  // De-dup by id: curated wins if a commands/-derived entry has the same id.
  // Build a Set of curated ids, then filter out any command entry that clashes.
  const curatedIds = new Set(CURATED_SKILLS.map((s) => s.id));
  const dedupedCommands = commandSkills.filter((s) => !curatedIds.has(s.id));

  // Stable order: opt-in commands (sorted by id above), then curated entries.
  return [...dedupedCommands, ...CURATED_SKILLS];
}

// ---------------------------------------------------------------------------
// Public: resolveSkillInvocation(repoRoot, id) → string | null
// ---------------------------------------------------------------------------
export async function resolveSkillInvocation(repoRoot, id) {
  if (!id || typeof id !== 'string') return null;
  const skills = await listSkills({ repoRoot });
  const found = skills.find((s) => s.id === id);
  return found ? found.invocation : null;
}
