# Minimalism Constraints (Ponytail)

> "The best code is the code you never wrote."

These constraints apply to **every** generation step in this engine — both manifests
(Phase 1) and source code (Phase 2). Writers and reviewers must both consult this file.

## The 6-rung hierarchy

Before adding anything (a screen, an endpoint, a store, a dependency, a file, a function),
walk down this ladder and stop at the first rung that satisfies the need:

1. **Necessity** — Is it actually required by a scope item (S-##), a block (B-##), or an
   ADR? If nothing in `context/` demands it, **do not add it.** Cut it.
2. **Standard library / built-in** — Can the platform's own primitives cover it?
3. **Native platform feature** — OS / browser / framework capability already available?
4. **Existing dependency** — Something already chosen in an ADR or already present?
5. **One-liner threshold** — If it collapses to a trivial inline expression, inline it
   rather than introducing an abstraction.
6. **Minimal custom implementation** — Only now write something new, and write the
   smallest version that satisfies the requirement.

## Applied to manifests (Phase 1)

- **No invented detail.** Do not fabricate endpoints, fields, props, routes, or shapes.
  If the KB does not support it, mark `[MISSING_INFO]` and cite the gap — never fill it.
- **Under-specify over over-specify.** A spec that records exactly what is known (and
  flags the rest) is more valuable than one padded with plausible-but-unsourced detail.
- **No speculative scope.** Don't add screens, modules, or tasks "for completeness" that
  aren't traceable to a scope/estimation item.
- **Reuse before defining.** Prefer referencing an existing shared component / query key /
  glossary term over coining a new one.

## Applied to code (Phase 2)

- Resolve each `BLOCK_TASKS` task with the **fewest files and lines** that meet the
  acceptance criteria.
- No dependency that isn't ADR-sanctioned or already installed.
- No abstraction without a second concrete caller. No config option no one sets.
- Delete dead scaffolding the generator emits but the task doesn't need.

## Reviewer hook

Every reviewer pass must explicitly answer: **"What can be removed?"** A finding of
"unnecessary / unsourced / over-engineered" is a first-class blocker, not a nit.
