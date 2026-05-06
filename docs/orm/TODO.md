# ORM TODO

Functionality present in the legacy `src/dbs` layer that has no equivalent in
`src/orm` yet. Each item is a candidate for a future ADR; none are committed.

## Change streams / CDC

`dbs` ships `Table.watch(callbacks)` backed by Debezium + Kafka: per-collection
topics, hydrated `before`/`after` payloads, computed diffs, and
`created`/`updated`/`deleted` callbacks. The orm has no change-stream surface,
no CDC config, and no event-bus integration.

## Paginated query envelope

`dbs` returns paginated reads as `{ pages: { current, start, last, previous,
next }, docs: { limit, total, count }, results }` via `queryParamsPipe` /
`queryResultsPipe`. The orm's `findMany` returns a flat array — no count, no
page math, no canonical query-params pipe.

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

## Typed driver escape hatch — resolved (pending implementation)

`dbs` exposes `table.extras.collection: Collection<Model>` so callers can drop
to the live driver object when needed. The orm's only escape hatch is
`repo.on(S).raw(...)`, which wraps a driver call but doesn't hand back a typed
handle to the underlying client/collection.

**Resolution:** see [ADR 2026-05-06 — Adapter is a class built via `configurable`](../adr/2026-05-06-adapter-as-class-via-configurable.md).
Once Adapter is a class, instance state is a normal class concept: each
adapter exposes its underlying driver as a public property
(`mongoAdapter.client: MongoClient`, `pgAdapter.pool: pg.Pool`, etc.). No
framework primitive needed; consumers reach the driver via the adapter
instance directly. Implementation pending — adapter authors decide which
fields to expose; the framework neither requires nor forbids it.

## Instance lifecycle integration — resolved (pending implementation)

`dbs` Mongo registers `Instance.on('start', ..., 3)` to connect and create
collections with `changeStreamPreAndPostImages` enabled, `Instance.on('close',
..., 1)` to shut down, calls `Instance.crash` on fatal config errors, and uses
`Instance.getScopedName` to namespace db names per environment. Orm adapters
expose plain `lifecycle.connect`/`disconnect` only — no Instance hooks, no
scoped naming, no pre/post-image bootstrap.

**Resolution:** see [ADR 2026-05-06 — Adapter is a class built via `configurable`](../adr/2026-05-06-adapter-as-class-via-configurable.md)
and [docs/instance/CONTEXT.md](../instance/CONTEXT.md).
The bundled landing reworks `Instance.on(...)` from numeric ordering to a
class-keyed DAG with `after: ClassRef[]` dependencies (auto-inverted for
`close`), and `OrmAdapter`'s constructor auto-registers `connect` /
`disconnect` against `Instance` based on method presence. A standard
`protected onFatalError(err)` hook on `OrmAdapter` routes driver errors to
`Instance.crash` by default. Implementation pending. Scoped naming and
pre-image collection bootstrap remain adapter-author-controlled —
`Instance.getScopedName` is callable from the adapter constructor or the
Repo resolver as needed; the framework does not auto-scope.

## Adapter config validation pipe — resolved (pending implementation)

`dbs` validates adapter config at construction with valleyed pipes
(`mongoDbConfigPipe`, `dbChangeConfigPipe`). The orm's
`Adapter.from<Config>()` types the config but does not validate it at
runtime — that's left to the user.

**Resolution:** see [ADR 2026-05-06 — Adapter is a class built via `configurable`](../adr/2026-05-06-adapter-as-class-via-configurable.md).
Adapter switches from builder to class via `configurable(connectionPipe, OrmAdapter)`,
which validates connection-level config at construction. Per-query schema
config is validated against a required `readonly schemaConfigPipe` on the
adapter class. Implementation pending.

## Aggregating data

A first-class aggregation surface — group-by, count/sum/avg/min/max, having,
projection — exposed through the Repo chain rather than only via adapter `raw`.
Today, anything beyond filter-based reads (counts, rollups, group-bys, joined
aggregates) has to drop to `repo.on(S).raw(...)` and use adapter-native
pipelines/SQL. A canonical aggregation builder would need its own canonical
op set (aggregation funcs), a new `aggregateOps` capability declaration, and a
`queryable.aggregate` (or equivalent) bag method, narrowed the same way as the
existing CRUD/queryable verbs.

## TODO From Copilot

## Hooks/Lifecycle Events (Partial)

Field-level hooks (`onCreate`/`onUpdate`) exist in Schema/Field classes for
individual fields, but no global/model-level event subscribers or before/after
hooks for entire entities. Missing: ORM-wide subscribers, per-model callbacks
(like `beforeInsert`/`afterDelete`), query-level hooks, and async hook support.

## Migrations

No migration tooling for schema evolution. Missing: migration files, up/down
scripts, schema diffing, and CLI for managing database schema changes.

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
