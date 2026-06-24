---
module: skills/planning
updated: 2026-06-24
files: []
---

## Purpose
Instructions for the planning agent using this knowledge base.

## How to approach this task

1. **Read the relevant knowledge files first**: use `read_knowledge_base` to load architecture and the modules you will touch.
2. **Search for prior patterns**: use `search_knowledge` with the concept you are working on.
3. **<Step three>**: description.

## Anti-patterns
- Do not proceed without reading the constraints sections of affected modules.
- Never skip the implementation order — dependencies must exist before dependents.
- Do not read raw source files. Use `read_knowledge_base` and `search_knowledge` only. Source files are for the compiler; `.knowledge/` is for agents.
- Do not skip `write_plan`. A plan described in conversation but not written to `PLAN.md` is not a plan.
