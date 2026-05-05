# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`docs/CONTEXT-MAP.md`** — it points at one `CONTEXT.md` per context under `docs/<context>/CONTEXT.md`. Read each one relevant to the topic.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in. All ADRs live in this single root location regardless of which context they affect.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The producer skill (`/grill-with-docs`) creates them lazily when terms or decisions actually get resolved.

## File structure

All agent-facing docs live under `docs/`; code lives under `src/`. Per-subsystem
`CONTEXT.md` files mirror the `src/` layout under `docs/`:

```
/
├── docs/
│   ├── CONTEXT-MAP.md
│   ├── adr/
│   │   ├── 2026-05-05-static-factory-builder-chain.md
│   │   └── 2026-05-05-library-owned-als-runtime-resolver.md
│   ├── agents/
│   └── orm/
│       └── CONTEXT.md
└── src/
    └── orm/
```

ADR files use an ISO-date prefix (`YYYY-MM-DD-slug.md`) so multiple devs can
land ADRs from parallel branches without renumbering conflicts. When a new
subsystem's vocabulary stabilises, add `docs/<name>/CONTEXT.md` and a row in
`docs/CONTEXT-MAP.md`.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/grill-with-docs`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
