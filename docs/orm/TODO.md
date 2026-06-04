# ORM TODO

Functionality present in the legacy `src/dbs` layer that has no equivalent in
`src/orm` yet. Each item is a candidate for a future ADR; none are committed.

## Change streams / CDC

`dbs` ships `Table.watch(callbacks)` backed by Debezium + Kafka: per-collection
topics, hydrated `before`/`after` payloads, computed diffs, and
`created`/`updated`/`deleted` callbacks. The orm has no change-stream surface,
no CDC config, and no event-bus integration.

## Multi-field text search

`dbs` accepts `params.search = { value, fields[] }` and builds a regex `$or`
across the listed fields, `$and`-merged with the where clause. The orm has
per-field `like`, but no built-in helper for "search this string across these N
fields".

## Row-level auth clause

`dbs` query params split user-supplied `where` from a separate `auth` filter,
each with its own `whereType` / `authType` combinator. The orm handles
multitenancy via `repo.resolve(transform, fn)`, which rewrites *config* — not
the *filter*. There is no row-level auth-predicate concept yet.

## TODO From Copilot

## Hooks/Lifecycle Events (Partial)

Field-level hooks (`onCreate`/`onUpdate`) exist in Schema/Field classes for
individual fields, but no global/model-level event subscribers or before/after
hooks for entire entities. Missing: ORM-wide subscribers, per-model callbacks
(like `beforeInsert`/`afterDelete`), query-level hooks, and async hook support.

## Migrations

Both the runtime ("A") and the codegen ("B") of the migrations subsystem
are designed and locked as of 2026-05-09 — see `docs/orm/CONTEXT.md`
§16 for the canonical reference and ADRs
`2026-05-09-migrations-runtime.md` + `2026-05-09-migrations-codegen.md`
for the decision trees. Implementation slice still pending (no
`src/orm/migrations/` yet).

Documented post-v1 enhancements (out of scope until real user need
surfaces, per §14 revisit policy):

- **Auto-FK derivation from Relations.** v1 codegen ignores the
  `Relations` artifact (§9). Post-v1, walk Relations alongside Schemas
  to auto-emit `addForeignKey` / `dropForeignKey` Changes when Relations
  change.
- **CLI layer.** v1 is programmatic-only; a thin `equipped migrate
  up/status` CLI on top of `Migrator.up()` etc. is a separate slice if
  user demand surfaces.
- **Topological sort for emission order.** v1 uses fixed canonical
  order (drops → renames → creates → adds). Self-referencing FKs and
  circular inter-table dependencies need manual reordering today;
  topological sort is implementable when real cases surface.
- **Historical-snapshot drift detection.** v1 codegen produces a diff
  *current → target* without comparing against a migration-history
  snapshot. Post-v1, optionally replay migration history into an
  in-memory shape and detect drift between expected and actual.

## Soft Deletes

No soft delete functionality. Missing: `softDelete()`, `withDeleted()`, `restore()`
methods, and automatic filtering of deleted records.

## Caching (L2/Result)

No second-level or query result caching. Missing: configurable cache layers,
invalidation strategies, and cache adapters.

## Observability (Metrics/Tracing)

No performance monitoring or telemetry. Missing: query logging, metrics
collection, tracing integration, and observability dashboards.

## Multi-Tenancy

No tenant isolation or scoping. Missing: row-level security, tenant-specific
filters, and multi-tenant schema support.

## Read Replicas

No routing logic for read/write splitting. Missing: replica configuration,
load balancing, and read/write query routing.

## Concurrency Control (Locking)

No optimistic or pessimistic locking. Missing: `setLock()`, version fields,
and concurrency-safe updates.

## Streaming APIs

No cursor-based or streaming result sets. Missing: large dataset handling,
memory-efficient iteration, and streaming query builders.

## CTEs (Common Table Expressions)

No WITH clause builders for complex queries. Missing: recursive queries,
temporary named result sets, and CTE chaining.

## Global Filters

No tenant-wide or soft-delete filters. Missing: automatic filter injection
across all queries for a schema or tenant.

## Seed Data Framework

No data seeding utilities beyond test helpers. Missing: seed files, seeding
CLI, and environment-specific data loading.

## CLI Tools

No command-line interface. Missing: migration commands, code generation,
schema inspection, and ORM management tools.

## Code Generation

No automatic model/entity generation. Missing: schema-to-code generators,
migration codegen, and boilerplate reduction.

## Field Encryption

No automatic field-level encryption/decryption. Missing: encrypted field types,
key management, and secure storage.

## Event Subscribers

No pub/sub system for lifecycle events. Missing: event-driven architecture
integration, custom event listeners, and reactive patterns.

## Field-Level Permissions

No granular access control on individual fields. Missing: permission-based
field filtering, role-based access, and security policies.
