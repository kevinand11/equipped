# Coding Standards

The reviewer agent loads this file via `@.sandcastle/CODING_STANDARDS.md` during code review.

The canonical coding-style guide for all my projects lives at `~/.claude/CODING-STYLE.md`. The reviewer agent is running inside a sandbox without access to that path, so the **rules below mirror it**. Keep this file in sync if `~/.claude/CODING-STYLE.md` is updated.

## Testing

- Unit tests live in the same file as the code under test, gated by `if (import.meta.vitest) { ... }` at the bottom of the file.
- Integration / e2e tests live in a sibling file at the same directory level (e.g. `users.e2e.ts` next to `users.ts`), never in a parallel `tests/` tree.
- Always follow TDD: write the failing test first, then the implementation that makes it pass. Bug fixes start with a failing reproduction test.

## Function & class declarations

- `function` declarations only for top-level operations that "do a thing" — service methods, audit handlers, repository operations.
- Arrow `const` for everything else: builders, factories, hooks/composables, validator/pipe combinators, callbacks, helpers.
- Avoid `class` unless the issue/PRD explicitly calls for one.

## Barrel files & namespacing

- Default to flat `export * from './module'` in barrels.
- Reach for `export * as Name from './module'` only when the call site genuinely reads better as `Name.thing` (e.g. `User.Entity`, `usersServices.find`).
- Namespace casing: types-bearing → `PascalCase`; functions-only → `camelCase`.

## Dependency wiring

- Module-level singletons by default (`const repository = makeRepository(...)` at the top, captured in closure by exported functions). No DI container, no factory wrappers, no `getX()` lookups.
- Break the singleton pattern only if a test seam genuinely requires it.

## Builder APIs

- `defineX(callback)` builder-chain only when later steps type-narrow against earlier steps (accumulator pattern).
- Independent-step builders → chain-on-instance (`v.string().min(3).max(50)`).

## Comments & documentation

- No JSDoc on exported symbols. TypeScript types describe shape; that's enough.
- Inline comments only when the *why* is non-obvious — phantom types, deliberate workarounds, surprising invariants. Never narrate the *what*.
- No file-header comments, no section-banner comments.

## TypeScript intensity

- Lean hard on the type system in library and shared-utility code (phantom params, uniqueness guards, accumulator types, conditional narrowing to `never`).
- Stay plain in application code (services, hooks, components, audits) — concrete types and generics only when the alternative is `any`.

## Validation & runtime types

- Every external input goes through a `valleyed` pipe before any code touches it (HTTP body, DB read, queue message, env var, third-party API response).
- The pipe is the source of truth for the type — derive types via `PipeOutput<P>`, `SchemaInput<S>`, `EntityClient<Entity>`, etc. Don't hand-write parallel `interface`/`type` for shapes that have a pipe.

## Errors & control flow

- New code returns errors via `Result<T, E>`, not by throwing.
- Compose Results via early-return (`if (!r.ok) return r`), not via `.map`/`.andThen` combinators.
- No `AbortSignal` threading through application service signatures — cancellation is the framework's job.

## Naming

- Files: `kebab-case` (always).
- Variables, functions: `camelCase`. Types, classes, type-bearing namespaces: `PascalCase`. Function-only namespaces: `camelCase`.
- Op helpers / pipe builders: lowercase. Compile-time constants: `SCREAMING_SNAKE_CASE` (rare).
- Booleans: `is`/`has`/`can` prefix on variables and methods; bare adjective on entity fields.
- No `Async` / `Sync` suffixes on functions.

## Imports & module organisation

- Inline `type` markers (`import { v, type Pipe } from 'valleyed'`), not separate `import type` lines.
- Cross-area imports go through module-scope barrels (`@stranerd/entities/users`, `equipped/orm`). Relative imports stay shallow — refactor anything beyond `../..`.

## Formatting

- Defer to `@k11/configs/prettier`. If it's not in the config, it's not a rule.

## Frontend (Vue / Nuxt)

- Composition API only, with `<script setup lang="ts">`.
- Composables are the unit of state and behaviour; module-level shared state is the default.
- Pinia only when SSR hydration requires it (Nuxt). Regular Vue/SPA → module-level refs in composables.
- Tailwind utility classes inline; no `<style>` blocks.
