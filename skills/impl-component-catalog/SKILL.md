---
name: impl-component-catalog
description: Generate the COMPONENT_CATALOG manifest — shared UI components, one canonical entry per input type (date, select, text, …); props, behavior, i18n. Enforces zero-duplicate UI consistency. Load before building shared components. Vendored Spine skill, gated by verification_tier (src/manifest-policy.js).
---

## Sources & gate (hivemind)

Vendored from implementation-engine. In hivemind the "context" this skill reads is the project's
knowledge surface — `PROJECT.md`, the wisearch brain graph (`kb_search`/`kb_answer`, or the local
`knowledge/` KB when the brain is offline), and the ticket's scope + acceptance criteria. Where the
body below refers to `context/<file>.md`, read the equivalent from that surface. Output goes to
`implementation/COMPONENT_CATALOG.md`.

**Gate:** required for **core** tickets (`verification_tier` tdd / tests-after), **skipped** for
`uat-only` glue — see `src/manifest-policy.js` (`requiresManifest`). Generate/update it BEFORE code;
the reviewer treats a missing required manifest as a HIGH finding. Preserve epistemic markers
(`[EXPLICIT]`/`[INFERRED:strong|weak]`/`[ASSUMED]`) and respect source tiers.

---

# impl-component-catalog

Generates `implementation/COMPONENT_CATALOG.md` — a catalog of shared UI components derived from the scope and technical context.

## Read first

Read these files from `context/` (and only from `context/`):
- `context/technical.md` — design system patterns, component conventions, brand tokens
- `context/scope.md` — feature areas that share common UI patterns

Also apply `.claude/shared/UI_CONSISTENCY.md`: **one canonical component per input type**,
variation via props only.

## Output: `implementation/COMPONENT_CATALOG.md`

Organize components into categories. For each component:

```markdown
## <ComponentName>

**Category**: <Primitives | Forms | Navigation | Data Display | Feedback | Layout>
**Used in**: S-## (screen name), S-## (screen name), ...

### Props
| Prop | Type | Required | Description |
|------|------|----------|-------------|
| label | string | yes | Button label text |
| onPress | () => void | yes | Tap handler |
| variant | "primary" \| "secondary" | no | Visual style (default: "primary") |

### Behavior
<Short description of interaction behavior, accessibility notes, or visual states>

### i18n
<Does this component render any translatable text? If yes, note which props carry i18n keys>
```

## Categories to cover

Derive the component list from recurring patterns across screens:

- **Primitives**: Button (variants: primary, secondary, ghost, destructive), Icon, Avatar, Badge, Divider, Chip/Tag
- **Forms**: TextInput, PasswordInput, PhoneInput, CountryPicker, **DateInput** (the single
  canonical date/calendar component: props `mode` date|datetime, `range`, `withTime`,
  `minDate`/`maxDate`, `locale`/`format` — every date field in the system uses this),
  Select/Dropdown, FormField (label + input + error), FileUpload (if in scope)
- **Navigation**: BottomTabBar, StackHeader, BackButton, TabBar (in-screen tabs)
- **Data Display**: CampaignCard, MetricCard, KPICard, PaymentRecord, ChatThread, WorkflowStepIndicator, NetworkMetricsTab, DataTable, EmptyState, SkeletonLoader
- **Feedback**: Toast/Snackbar, Modal, ConfirmDialog, ProgressBar, LoadingSpinner, ErrorBoundaryFallback
- **Layout**: Screen (safe-area wrapper), SectionList, FilterPanel, SearchBar

Adjust the list based on what the scope actually requires — do not add components for out-of-scope features.

## Rules

- **One canonical component per input type.** A given input kind (date, select, text, file,
  etc.) gets exactly one catalog entry; context differences are props, not new components.
  Never list two entries for the same input type — consolidate into props.
- Centralize formatting/locale (dates, numbers, currency) inside the canonical component, not
  per-screen — this is the usual source of "they're all slightly different".
- Use generic prop type descriptions (string, number, boolean, function, enum) — do not assume a specific framework's prop system unless quoting an ADR.
- Flag components whose props depend on unknown API shapes with `[MISSING_INFO]`.
- Components that only appear once in one screen are not shared components — omit them.
- Do not prescribe implementation details (hooks, internal state) — catalog the interface, not the internals.

## After writing

Report: total components cataloged, categories covered, any `[MISSING_INFO]` entries.
