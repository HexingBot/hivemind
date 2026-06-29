---
name: impl-project-structure
description: Generate the PROJECT_STRUCTURE manifest — annotated source tree, module boundaries, import conventions, and ADR-decided stack assumptions (language/framework-agnostic). Load when establishing or extending the project skeleton. Vendored Spine skill, gated by verification_tier (src/manifest-policy.js).
---

## Sources & gate (hivemind)

Vendored from implementation-engine. In hivemind the "context" this skill reads is the project's
knowledge surface — `PROJECT.md`, the wisearch brain graph (`kb_search`/`kb_answer`, or the local
`knowledge/` KB when the brain is offline), and the ticket's scope + acceptance criteria. Where the
body below refers to `context/<file>.md`, read the equivalent from that surface. Output goes to
`implementation/PROJECT_STRUCTURE.md`.

**Gate:** required for **core** tickets (`verification_tier` tdd / tests-after), **skipped** for
`uat-only` glue — see `src/manifest-policy.js` (`requiresManifest`). Generate/update it BEFORE code;
the reviewer treats a missing required manifest as a HIGH finding. Preserve epistemic markers
(`[EXPLICIT]`/`[INFERRED:strong|weak]`/`[ASSUMED]`) and respect source tiers.

---

# impl-project-structure

Generates `implementation/PROJECT_STRUCTURE.md` — an annotated source tree with module boundaries and import conventions.

## Read first

Read these files from `context/` (and only from `context/`):
- `context/technical.md` — tech stack, system components, architecture patterns
- `context/scope.md` — feature modules and their boundaries
- `context/adrs.md` — all ADR decisions (especially framework, navigation, state, API)

## Output: `implementation/PROJECT_STRUCTURE.md`

### Section 1: ADR decisions summary

Open with a compact table of all ADR decisions from `context/adrs.md`. These are the project-specific technology choices that inform the structure below.

```markdown
## Project Technology Decisions

| ADR | Decision | Status |
|-----|----------|--------|
| ADR-01 | Mobile framework: React Native | Confirmed |
| ADR-04 | State: React Query + Zustand | Confirmed |
| ... | ... | ... |
```

### Section 2: Source tree

Present the full source tree with an inline comment per file/folder explaining its purpose. Base the structure on the decided stack (ADR-01 through ADR-07) but add a note at the top that the logical boundaries (screens/, services/, state/) apply regardless of language or framework.

```
src/
├── navigation/           # router setup; one file per navigator
│   ├── RootNavigator     # entry point: auth gate → main tabs
│   ├── AuthNavigator     # login, register, onboarding stack
│   ├── MainTabNavigator  # 4-tab bottom nav
│   ├── CampaignNavigator # campaign list → detail → workflow stack
│   └── ProfileNavigator  # profile, settings stack
│
├── screens/              # one folder per scope item (S-##)
│   ├── auth/             # S-AUTH: login, register, onboarding, forgot-password
│   ├── home/             # S-HOME: dashboard
│   ├── campaigns/        # S-CAMP: list, filter, detail, apply
│   ├── workflow/         # S-WORK: 7-step campaign workflow
│   ├── chat/             # S-CHAT: brand threads
│   ├── profile/          # S-PROF: metrics, mediakit, campaign history
│   ├── settings/         # S-SET: personal data, security, preferences
│   ├── payments/         # S-PAY: balance, history, collect
│   └── reports/          # S-REP: analytics, CSV export
│
├── components/           # shared components (see COMPONENT_CATALOG.md)
│   ├── primitives/
│   ├── forms/
│   ├── navigation/
│   ├── data-display/
│   ├── feedback/
│   └── layout/
│
├── services/             # external integrations (one file per integration)
│   ├── http/             # HTTP client setup, auth interceptors, error handling
│   ├── push/             # push notification registration and handling
│   ├── storage/          # secure token storage abstraction
│   └── analytics/        # crash reporting + usage analytics
│
├── queries/              # server state: query hooks grouped by module
│   ├── auth.ts
│   ├── campaigns.ts
│   ├── workflow.ts
│   ├── payments.ts
│   ├── profile.ts
│   ├── chat.ts
│   └── reports.ts
│
├── state/                # UI state stores (one file per domain)
│   ├── ui.ts             # global UI flags (loading overlays, active tab)
│   └── <module>.ts       # per-module UI state if needed
│
├── i18n/                 # internationalization
│   ├── index             # i18n initialization, language detection
│   ├── locales/
│   │   ├── es.json       # Spanish (primary)
│   │   └── en.json       # English (confirmed in scope)
│
├── types/                # shared TypeScript interfaces
│   ├── api.ts            # request/response shapes
│   ├── domain.ts         # Campaign, Profile, Payment, etc.
│   └── navigation.ts     # route params per navigator
│
└── utils/                # pure helpers (no side effects)
    ├── formatters.ts     # currency, dates, numbers
    ├── validators.ts     # RUC, phone, email
    └── constants.ts      # app-wide constants
```

### Section 3: Module boundaries

Define what each module owns and what it must not import from other modules:

- `screens/` may import from `components/`, `queries/`, `state/`, `services/`, `i18n/`, `types/`, `utils/`
- `queries/` may import from `services/http/` and `types/`
- `state/` may import from `types/` only
- `components/` may import from `types/`, `i18n/`, `utils/` — never from `screens/` or `queries/`
- `services/` must not import from `screens/`, `queries/`, or `state/`

### Section 4: Adaptation note

Add a brief note explaining that the logical boundaries (screens, services, queries/data-fetching, state, components, i18n, types, utils) are framework-agnostic. The file names and tool choices in Section 2 reflect the ADR decisions for this project; a different stack would use the same boundaries with different tooling.

## Rules

- Base file/folder names on the decided stack only in sections that call out ADR decisions explicitly.
- Keep the tree focused on `src/` — do not enumerate config files, CI scripts, or test infrastructure here.
- Do not add files for out-of-scope features (AI agent integration, backend, web platform).

## After writing

Report: number of top-level modules, number of screens folders, any structural decisions that needed `[ASSUMED]` or `[MISSING_INFO]` markers.
