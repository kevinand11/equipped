# Equipped ORM — Context

This document is the long-lived reference for the ORM in `equipped`. It defines
the canonical vocabulary used across the ORM, the rules that govern every layer,
and the items that are explicitly out of scope.

The ORM is a typed, capability-aware Repo over user-supplied adapters. The
package ships **no** database-specific implementations — adapters are always
third-party, including the in-memory adapter used in tests. The conceptual stack
is **Schema → Relations → Adapter → Repo**, with Repo construction taking a
ContextSource for per-query config transforms. The TypeScript type system
narrows the Repo's surface to exactly what the adapter declares it can do; any
mismatch is a compile error, not a runtime throw. Validation runs once, in the
package, at the Repo-entry boundary; the adapter is handed validated input.

Each section below is the canonical reference for one layer or cross-cutting
concern. Sections 13 and 14 cover principles and explicit non-goals.

---

## 1. Definitions (the four artifact kinds)

The ORM has exactly four top-level **definitions**. Each is constructed by a
`defineX(callback)` factory function (the **builder-chain rule** — see §2).

### 1.1 Schema

A **Schema** is a typed description of a single document shape — its name, its
PK field, its data fields, and any computed fields. A Schema is
adapter-agnostic and relations-agnostic; it carries valleyed pipes for
validation and TypeScript types for compile-time inference.

A Schema is **not** a table, a collection, a model class, a row object, or an
instance. It is not bound to a database. It is not aware of relations. It is
not aware of adapters.

```ts
const UserSchema = defineSchema('users', (s) => s
  .pk('id', v.string(), () => crypto.randomUUID())
  .field('email', v.string())
  .field('age', v.number())
  .field('createdAt', v.number(), { onCreate: () => Date.now() })
  .field('updatedAt', v.number(), { onUpdate: () => Date.now() })
)
```

Vocabulary:

- A **field** is a schema-side declaration (`schema.fields.email`). Never call
  these "columns" — that leaks SQL framing.
- A **document** is a runtime row returned by a Repo method. Adapter-neutral
  (works for SQL rows, Mongo docs, Firebase docs).
- The schema's `fields` accessor returns **schema-tagged Field** instances —
  each `Field<T, N, S>` carries a phantom parent-schema parameter `S` (see
  §9.2) that lets the type system constrain FK refs and filter ops to the
  correct parent schema.

### 1.2 Relations

A **Relations** is a typed description of how one schema connects to others.
Relations are stored in a separate artifact from the schema and wire `hasMany`
/ `hasOne` / `belongsTo` descriptors keyed by name. The plural form is
intentional: a single `defineRelations` call declares multiple relations, so
the artifact is *a Relations* (singular noun, plural form).

Relations are **not** part of the schema, **not** enforced by the database (no
DDL), and **not** automatically bidirectional. A `User → posts` `hasMany` does
not imply `Post → user` `belongsTo`; both must be declared if both are wanted.

```ts
const UserRels = defineRelations(UserSchema, (rel, src) => rel
  .hasMany('posts', PostSchema.fields.userId)
  .belongsTo('org', src.fields.orgId, OrgSchema)
  .hasOne('profile', ProfileSchema.fields.userId)
)
```

Vocabulary:

- A **relation** is one entry inside a Relations (e.g. `UserRels.posts`).
- The three **relation kinds** are `hasMany`, `hasOne`, `belongsTo`.
- The **source schema** is the schema passed first to `defineRelations`; the
  **target schema** is the schema being related to.
- See §9 for full Relations vocabulary.

### 1.3 Adapter

An **Adapter** is a capability declaration plus a set of method-bag
implementations that the framework calls to talk to a specific database. An
Adapter is always third-party (the package ships none) and bound to a specific
database driver/SDK.

An Adapter is **not** a connection. It is **not** stateful per-database — one
Adapter object can serve many connections; connection pooling is the adapter's
internal concern. It is **not** a Repo (Repo wraps an Adapter; an Adapter
doesn't know about Repo).

```ts
const PostgresAdapter = defineAdapter((a) => a
  .config({} as PgCfg)
  .queryableOps('eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'like', 'exists', 'notExists', 'contains', 'notContains')
  .updateOps('set', 'inc', 'mul', 'min', 'max', 'unset', 'push', 'pull', 'patch')
  .supportedFieldTypes('string', 'number', 'boolean', 'null', 'object', 'array', 'date')
  .lifecycle({ connect, disconnect })
  .crud({ findByPk, insertMany, updateByPk, deleteByPk, raw })
  .queryable({ findMany, updateMany, deleteMany, upsertOne })
  .transactional({ session })
)
```

Vocabulary:

- The Adapter has two kinds of named parts: **behaviours** (runtime method
  groups: `lifecycle`, `crud`, `queryable`, `transactional`) and **capability
  declarations** (literal-list type-only fields: `queryableOps`, `updateOps`,
  `supportedFieldTypes`).
- There is no "capability" umbrella term. Cross-cutting effects (e.g.
  `updateOps` gating ops on update methods) are described by their declaration.
- See §3 for the full Adapter surface vocabulary.

### 1.4 Repo

A **Repo** is the user-facing object with `findByPk`, `findMany`, `insertOne`,
`session`, and other methods. A Repo wraps an Adapter and a config-resolution
path. A single Repo handles all schemas (see **schema-per-call**, §5.2).

A Repo is **not** per-schema (no `userRepo` / `postRepo` split). It is **not** a
connection. It is **not** a database client. It is **not** aware of
multi-tenancy directly — tenant context flows through `ContextSource` (§6).

```ts
const repo = defineRepo((r) => r
  .adapter(PostgresAdapter)
  .resolve((schema) => ({ table: schema.name }))
  .context(myContextSource)
)

await repo.findByPk(UserSchema, 'u1')
await repo.findMany(UserSchema, q => q.gt(UserSchema.fields.age, 18))
await repo.session(async () => {
  await repo.insertOne(UserSchema, { ... })
  await repo.updateOne(OrderSchema, q => q.eq(OrderSchema.fields.id, 'o1'), set({...}))
})
```

Vocabulary:

- The **Repo surface** is the typed shape of all Repo methods.
- **Repo methods** is the prose term for `findByPk` / `findMany` / etc.
- **schema-per-call** is the calling pattern (`repo.findByPk(UserSchema, 'u1')`
  rather than `userRepo.findByPk('u1')`).
- See §5 for the full Repo surface vocabulary.

### 1.5 Cross-artifact conventions

- Every artifact construction factory uses the form `defineX(callback)`. The
  package does not export class constructors (no `Schema.from(...)`).
- Pluralisation uses natural English plurals (`schemas`, `adapters`, `repos`).
  `Relations` is a singular noun in plural form; capitalise when ambiguous.
- The collective term for "things produced by `defineX`" is **definition**.

---

## 2. Builder-chain factory pattern

The pattern `defineX((b) => b.step1().step2())` is the canonical shape for all
artifact construction in the package. This section locks the vocabulary and
rules of the pattern.

### 2.1 Vocabulary

- A **factory** is the outer function (`defineSchema`, `defineRelations`,
  `defineAdapter`, `defineRepo`).
- The **build callback** is the argument to the factory (`(b) => b.step1()...`).
- The **builder** is the object the build callback receives.
- A **builder step** is a method on the builder (`.field()`, `.queryableOps()`,
  `.crud()`).
- The **accumulator type** is the generic on the builder that grows as steps
  are called. Each step returns a new builder whose accumulator includes the
  declarations from prior steps.

### 2.2 Rules

- **Builder-chain rule.** Builder-chain factories are the default for all
  declarative artifact construction in the package. New `defineX` follows this
  shape; flat-object factories deferred unless a concrete reason to deviate.
- **Once-per-step rule.** Each builder step is callable at most once. Calling
  the same step twice is a compile error via the **uniqueness guard**
  (see §2.3).
- **Per-step coherence.** Later steps reference earlier accumulator state.
  Examples: `.queryable({...})`'s methods are typed against `.queryableOps(...)`
  declared earlier; `.computed({...})`'s `deps` are constrained to prior
  `.field(...)` names. Violations fire at the offending call line, not at the
  end of the chain.
- **Rest-args convention.** Op lists use rest-args, not array literals:
  `.queryableOps('eq', 'ne', 'gt')` — not `.queryableOps(['eq', 'ne', 'gt'])`.
  Uses TS 5.0+ `const` type parameters
  (`<const Ops extends readonly OpName[]>`) to preserve literal types in
  rest-args without `as const`.
- **Omission-equals-empty rule.** A builder step not called means the artifact
  doesn't declare that capability. Op-list fields default to `readonly []`;
  behaviours default to absent.

### 2.3 Uniqueness guard

The TypeScript pattern that makes duplicate keys fail at compile time:

```ts
class XBuilder<Acc extends Record<string, unknown> = {}> {
  step<K extends string>(
    name: K extends keyof Acc ? never : K,
    ...
  ): XBuilder<Acc & Record<K, ...>> { ... }
}
```

If the user attempts `.step('foo', ...).step('foo', ...)`, the second `'foo'`
resolves to `never` and TS errors at the offending line. This is the
**uniqueness guard**; it underpins the once-per-step rule and duplicate-key
safety throughout the package.

### 2.4 Non-construction calls

Builder-chain is only for *declarative artifact construction*. The following
are **non-construction calls** and use direct function/method calls:

- **Repo invocation methods** (schema-per-call): `repo.findByPk(schema, pk)`,
  `repo.findMany(...)`, etc.
- **Session entry**: `repo.session(fn)`.
- **Op helpers** and **descriptor helpers**: `set(...)`, `inc(...)`,
  `hasMany(...)`, `belongsTo(...)`. These construct operation values used as
  arguments to other calls; they are single-shot and a chain would add ceremony
  for no benefit.

### 2.5 Query builder (the FilterFactory exception)

The `FilterFactory` callback `q => q.eq(...).and(...)` (see §11) is itself a
builder chain on `FilterGroup`. It is the **query builder** — a builder-chain
sub-pattern distinct from artifact `defineX` builders, used for filter trees.
The same vocabulary applies (steps, rest-args, etc.); the difference is what's
being constructed (filter trees, not artifacts) and the recursive nesting via
`and([(g) => ...])` / `or([(g) => ...])`.

---

## 3. Adapter surface & narrowing

This section describes the rules and vocabulary around the Adapter's behaviours
and capability declarations, and how they narrow the Repo's surface.

### 3.1 Behaviours

A **behaviour** is a runtime method group on the Adapter. There are exactly
four:

| Behaviour | Methods (each independently optional) |
|---|---|
| `lifecycle` | `connect`, `disconnect` |
| `crud` | `findByPk`, `insertMany`, `updateByPk`, `deleteByPk`, `raw` |
| `queryable` | `findMany`, `updateMany`, `deleteMany`, `upsertOne` |
| `transactional` | `session` |

Every behaviour is optional. Many adapter targets (Firestore, DynamoDB, edge
serverless drivers, in-memory mocks, REST-API adapters) have no meaningful
connect/disconnect — forcing no-op stubs is silent ceremony, so `lifecycle` is
optional too.

Within a behaviour, methods are independently optional. An adapter can declare
`crud: { findByPk, raw }` only — read-only with an escape hatch.

### 3.2 Capability declarations

A **capability declaration** is a literal-list field on the Adapter that gates
ops or field types. There are exactly three:

| Declaration | Canonical set | Gates |
|---|---|---|
| `queryableOps` | filter ops | which filter ops the adapter supports |
| `updateOps` | update ops | which update ops `update*` and `upsertOne` accept |
| `supportedFieldTypes` | field types | which schemas can pair with the adapter |

`updateOps` is a value-level union of `AnyUpdateOp` variants the adapter
supports. It is not a capability registry — surface methods like `upsertOne`
are gated on behaviour-method presence, not on `updateOps` membership (§5.1,
§12.2).

Each declaration's values are drawn from a closed canonical set (§4). Adapters
**subset** the canonical set; they cannot add new members.

### 3.3 Co-required pair

A **co-required pair** is a structural relationship where a behaviour and a
declaration are both required for the surface to make sense. Currently only
one such pair exists:

- `queryable` behaviour ↔ `queryableOps` declaration.

The factory rejects `.queryable({...})` if `queryableOps` was not called with a
non-empty list. The methods in the `queryable` behaviour are meaningless
without ops to filter by.

Other declarations are cross-cutting (no paired behaviour):

- `updateOps` modifies which ops `updateByPk` (in `crud`), `updateOne` /
  `updateMany` (in `queryable`), and `upsertOne` (in `queryable`) accept.
- `supportedFieldTypes` gates whether *any* schema can be passed to *any* Repo
  method — schema-arg-level constraint, not behaviour-level.

### 3.4 Surface narrowing and structural inference

The **Adapter surface** is the union of all behaviours and capability
declarations on an Adapter. The Adapter **declares** a behaviour or op when it
appears in the definition; an absent behaviour or op is **undeclared**.

**Surface narrowing** is the process by which the Repo's typed methods are
reduced based on the Adapter's declarations. The result of narrowing is the
Repo surface; methods whose required behaviour or op is undeclared are
**narrowed-out methods** — their type resolves to `never`, so calling them is
a compile error.

**Structural inference** is the rule that the Adapter's set of supported
capabilities is inferred from which capability declarations and behaviours are
present. There is no explicit `capabilities: [...]` array. Presence is the
declaration.

### 3.5 Per-op gating, parity, and the no-emulation rule

**Per-op gating** is the TypeScript-level mechanism by which an undeclared op
becomes a compile error. The op-list declarations (`queryableOps`, `updateOps`)
drive per-op gating; the field-type declaration (`supportedFieldTypes`) drives
schema-arg gating.

**Declaration-implementation parity** is the invariant that the factory
compile-errors on any mismatch between a declaration and its implementation
(e.g. `.queryable({...})` rejecting ops that aren't in `queryableOps`).
Implementation cannot exceed declaration; declaration cannot lack
implementation.

**No-emulation rule.** The framework never emulates a missing op or behaviour
client-side. If an adapter doesn't declare an op, calling it is a compile
error. Adapter-specific power lives in the adapter's `raw` method only. The
framework does not silently fall back to `findMany` + filter to emulate
unsupported ops.

---

## 4. Canonical sets

The three capability declarations take values from closed canonical sets. This
section locks the canonical sets, naming conventions for their members, and the
rules for adding to them.

### 4.1 Canonical filter-op set

A **filter op** is one of:

```
eq · ne · gt · gte · lt · lte · in · notIn · like · exists · notExists · contains · notContains
```

The **notX-prefix convention**: positive ops keep short natural names (`in`,
`exists`, `contains`); negative ops use a `notX` English prefix (`notIn`,
`notExists`, `notContains`) — never SQL-style `nX` shorthand (no `nin` /
`nexists` / `ncontains`).

The **name-parity rule**: a filter op's string-literal value is identical to
the corresponding method/helper name. The `eq` method on `FilterGroup` writes
`'eq'` to `Filter.op`; the `notExists` method writes `'notExists'`. The wire
form is self-describing.

`notExists` is its own enum value, **not** a boolean form of `'exists'`. Each
op has at most one `value` payload; no op overloads its `value` field as a
flag.

### 4.2 Canonical update-op set

An **update op** is one of:

```
set · inc · mul · min · max · unset · push · pull · patch
```

The **lowercase-verb convention**: all update ops are lowercase, mostly
verb-form. Future additions must respect this. `Set`, `INC`, `addToSet`,
`arrayPush` are all rejected by the convention.

Every member of the canonical update-op set has a corresponding op variant
(§10.1) and an op helper (§10.2). The set is closed (§4.4) — adapters subset
it; method-shape capabilities (e.g. `upsertOne`) are gated on behaviour
presence, not by adding members to this set.

### 4.3 Canonical field-type set

A **field type** is one of:

```
string · number · boolean · null · object · array · date
```

The **JS-aligned field-type naming**: members match a JS primitive or
built-in constructor name in lowercase. `'null'` is explicit despite
`typeof null === 'object'`; `'array'` is explicit despite arrays being objects;
`'date'` is named after the `Date` constructor. Future additions must align
the same way. `'str'`, `'int'`, `'timestamp'`, `'json'` are all rejected.

The set is exposed as `type FieldType = 'string' | 'number' | ...` and the
inference helper `FieldTypeOf<P>` derives a field type from a valleyed pipe's
output. `SchemaFieldTypes<S>` is the union of all field types in a schema.

### 4.4 Closed-set rule and extensions

**Closed-set rule.** Adapters subset the canonical sets. They cannot add new
filter ops, update ops, field types, or relation kinds. Custom adapter-specific
power goes through the adapter's `raw` method only.

A **canonical-set extension** (adding a new member to one of the canonical
sets) is a maintainer-side process. The **canonical-extension contract**
requires:

- (a) the canonical type literal is added to the union;
- (b) the corresponding method or helper is added (filter ops get FilterGroup
  methods; update ops get op helpers; field types get
  FieldTypeOf branches);
- (c) at minimum, the in-memory adapter is updated;
- (d) all locked rules in §4.1–4.3 are respected (notX-prefix,
  lowercase-verb, JS-aligned naming, name-parity).

A canonical-set extension is a breaking change and requires a major-or-minor
package version bump per semver.

### 4.5 Out-of-scope field types

`'binary'` (Uint8Array / Buffer) and `'bigint'` are explicitly **out-of-scope
field types**. They are not part of the canonical field-type set and not
planned for inclusion. Adapters must not invent unofficial field types for
them. Users who need binary blobs or arbitrary-precision integers either:

- Encode them as a supported type (binary → base64 string; bigint → string), or
- Go through the adapter's `raw` method for adapter-native handling.

These items are out of scope, not deferred. See §14 for the full out-of-scope
inventory.

---

## 5. Repo surface & schema-per-call

### 5.1 Repo surface and gated methods

The **Repo surface** is the typed shape of all Repo methods. Every Repo method
is a **gated method** — its presence on the surface depends on the Adapter's
declarations:

| Method | Gate |
|---|---|
| `findByPk` | `crud.findByPk` declared |
| `insertOne` / `insertMany` | `crud.insertMany` declared |
| `updateByPk` | `crud.updateByPk` declared AND non-empty `updateOps` |
| `deleteByPk` | `crud.deleteByPk` declared |
| `raw` | `crud.raw` declared |
| `findOne` / `findMany` | `queryable.findMany` declared |
| `updateOne` / `updateMany` | `queryable.updateMany` declared AND non-empty `updateOps` |
| `deleteOne` / `deleteMany` | `queryable.deleteMany` declared |
| `upsertOne` | `queryable.upsertOne` declared |
| `session` | `transactional.session` declared |

There is no truly "always-on" method; every method is gated by something.
Methods whose gates aren't satisfied are narrowed-out (§3.4) — their type
resolves to `never` and calling them is a compile error.

### 5.2 Schema-per-call

**Schema-per-call** is the calling pattern: the schema is the first argument to
every Repo invocation method, instead of being baked into a per-schema Repo:

```ts
await repo.findByPk(UserSchema, 'u1')
await repo.findOne(UserSchema, q => q.eq(UserSchema.fields.email, 'a@b.com'))
await repo.insertOne(UserSchema, { name: 'Alice', email: 'a@b.com' })
await repo.updateOne(UserSchema, q, set({ name: 'Alicia' }))
```

The argument being passed in is the **schema arg**.

**Per-call type narrowing**: each Repo method's return type narrows to
`SchemaOutput<S>` (or `SchemaOutput<S> | null`, etc.) based on the schema arg.
The Repo is parameterised by Adapter only (`Repo<A>`); per-call return types
flow through the `S` generic on each method.

### 5.3 SchemaCompatible

`SchemaCompatible<A, S>` is the TypeScript guard that wraps every schema-arg
position. It resolves to `S` if every field type in the schema is in
`A['supportedFieldTypes'][number]`, and to `never` otherwise.

```ts
findMany<S extends AnySchema>(
  schema: SchemaCompatible<A, S>,
  q: FilterFactory,
  opts?: QueryOptions,
): Promise<SchemaOutput<S>[]>
```

Pairing an Adapter with a schema using a field type the Adapter doesn't declare
produces a **schema-incompatibility error** — TS error 2345 at the schema-arg
position of every Repo method call.

### 5.4 PK-keyed methods vs filter-based methods

Repo methods split into two families:

- **PK-keyed methods** live in the `crud` behaviour: `findByPk`, `insertOne`,
  `insertMany`, `updateByPk`, `deleteByPk`, `raw`. They identify documents
  directly by primary key.
- **Filter-based methods** live in the `queryable` behaviour: `findOne`,
  `findMany`, `updateOne`, `updateMany`, `deleteOne`, `deleteMany`,
  `upsertOne`. They identify documents via a `FilterGroup` filter (§11).

The split mirrors the adapter behaviour split. PK-keyed and filter-based Repo
methods can be declared independently — an adapter can be PK-only (no
`queryable` behaviour) or query-only (only `queryable`).

### 5.5 The `raw` escape hatch

The `raw` method on the Repo is the **escape hatch** for adapter-specific
power. Its signature is adapter-defined; its parameters and return type pass
through from the adapter's `crud.raw` method. All adapter-specific filter
shapes, server-side joins, aggregates, and out-of-scope features go through
`raw`.

The escape hatch is intentionally untyped at the Repo level — it is the
adapter author's responsibility to type and document `raw` per-adapter.

### 5.6 Session method

The **session method** is `repo.session(fn)`. It is the only transaction
surface in the package. Inside a **session**, every `repo.<method>(schema, ...)`
call routes through the same adapter and joins the active tx connection
automatically. The function passed to `session(fn)` is the **session callback**.

See §8 for the full session vocabulary.

---

## 6. Configuration resolution & ContextSource

The Repo holds two pieces of config-machinery: a base resolver that maps a
schema to a config, and an optional context source that returns a per-query
transform on top of that base config.

### 6.1 Base resolver and base config

The **base resolver** is the function passed to `defineRepo(.resolve(schema =>
Cfg))`. It produces a **base config** per schema. The C in `OrmAdapter<C>` is
the base config type — it's the type the adapter declares it consumes.

```ts
const repo = defineRepo((r) => r
  .adapter(PostgresAdapter)
  .resolve((schema) => ({ table: schema.name }))
)
```

### 6.2 ConfigTransform, ContextSource, context lookup

A `ConfigTransform<C>` is a function `(cfg: C, schema: AnySchema) => C` that
transforms a base config per query. The transform receives the base config and
the schema being queried, and returns a (potentially modified) config.

A `ContextSource<C>` is a hook object with a single method:

```ts
type ContextSource<C> = {
  get: () => ConfigTransform<C> | null
}
```

The framework calls `contextSource.get()` per query — a **context lookup** — to
get the active transform. If the lookup returns `null`, no transform is
applied.

```ts
const repo = defineRepo((r) => r
  .adapter(PgAdapter)
  .resolve((s) => ({ table: s.name }))
  .context(myContextSource)
)
```

### 6.3 Config resolution pipeline

The **config resolution pipeline** is the per-query process that produces the
**effective config** — the config actually handed to the adapter:

1. **Base resolve.** `defineRepo(.resolve(...))` runs against the schema.
2. **Context lookup.** `contextSource.get()` runs.
3. **Transform application.** If the lookup returned a non-null transform, it
   is applied on top of the base config.

The **base-then-transform rule** locks this ordering. The **no-context
fallthrough**: when the context lookup returns `null` (or no `ContextSource` is
configured), the effective config equals the base config.

The **per-query resolution rule**: this pipeline runs for every query —
top-level Repo calls, preload sub-queries (§9.8), and queries inside a session.
There is no session-level or Repo-level config caching that bypasses the
pipeline.

### 6.4 Scope-entry mechanism and the zero-ALS rule

A **scope-entry mechanism** is the user-owned thing that decides what
`ContextSource.get()` returns at any moment. Examples: Node `AsyncLocalStorage`
with `tenantStore.run(...)`, Hono context-storage middleware, NestJS
request-scoped DI, explicit threading.

The **zero-ALS rule** is the invariant that the library imports zero
`node:async_hooks` and never enters or runs ALS scopes itself. The user owns
scope-entry. The library only consumes the result via `ContextSource.get()`.

This keeps the library runtime-portable (Node, Bun, Deno, Cloudflare Workers,
Vercel Edge, etc.) and lets users plug in non-ALS strategies (DI, explicit
threading, future TC39 AsyncContext) without library changes.

### 6.5 Tenant scoping

**Tenant scoping** is the canonical use case for `ContextSource`. Pattern:
wrap requests in a scope-entry mechanism whose `ContextSource` returns a
tenant-prefix transform.

```ts
import { AsyncLocalStorage } from 'node:async_hooks'

const tenantStore = new AsyncLocalStorage<{ id: string }>()

const tenantContext = {
  get: () => {
    const t = tenantStore.getStore()
    if (!t) return null
    return (cfg) => ({ ...cfg, table: `t_${t.id}_${cfg.table}` })
  },
}

export const runInTenant = <T>(id: string, fn: () => Promise<T>) =>
  tenantStore.run({ id }, fn)

const repo = defineRepo((r) => r
  .adapter(PgAdapter)
  .resolve((s) => ({ table: s.name }))
  .context(tenantContext)
)

// Middleware
app.use((req, _res, next) => runInTenant(req.header('x-tenant')!, () => next()))
```

The **untenanted-query footgun**: if the user forgets to enter a scope on a
route, `ContextSource.get()` returns `null` and queries silently hit the
unprefixed base table. Two documented mitigations:

- **Fail-loud pattern.** Throw inside `ContextSource.get()` when no tenant is
  active: `if (!t) throw new Error('untenanted query')`. Fail loud for any
  query outside a tenant scope.
- **Sentinel scope pattern.** Wrap legitimate non-tenant code (admin routes,
  migrations) in `tenantStore.run({ id: '__untenanted__' }, ...)` so
  missing-tenant is impossible by construction.

The library doesn't enforce either; admin and migration routes have legitimate
non-tenant uses.

### 6.6 Cross-schema sessions and scope-session composition

**Scope-session composition**: when a tenant scope wraps a session, every query
inside picks up both the tenant transform (user-owned via `ContextSource`) and
the tx connection (adapter-internal via tx-context propagation, see §8). The
two layers compose without interaction — the tenant transform runs in the
config resolution pipeline; the tx connection routing happens inside the
adapter.

### 6.7 What's not in the model

- **Single-Repo rule.** A Repo is built once with a single base resolver and
  ContextSource. Per-tenant or per-context derivation is achieved via the
  ContextSource hook, not by deriving sub-Repos. There is no
  `repo.withConfig(transform)` chain.
- **No-registry rule.** There is no global registry mapping schemas to Repos.
  A Repo handles all schemas it can compatibility-narrow against.
- **Adapter-only-typed-Repo rule.** A Repo is parameterised by Adapter only
  (`Repo<A>`), not `Repo<S, A>`. Per-call return types narrow via the schema
  arg's `S` generic.

---

## 7. Validation flow

Validation runs once, in the package, at the Repo-entry boundary. Adapters
never re-validate.

### 7.1 Repo-entry boundary and the validate-once rule

The **Repo-entry boundary** is the location where validation runs: at the
entry of every Repo method, before any adapter call. The **validate-once rule**:
validation runs exactly once, at the Repo-entry boundary; the adapter receives
**validated input** and is not expected to re-validate.

### 7.2 Insert, update, and filter validation

Three families of validation, each named by its function:

- **`validateInsert(schema, document)`** runs on `insertOne` / `insertMany`
  inputs. Validates the full document against schema pipes; injects `onCreate`
  defaults for missing fields. Rule: **insert-validates-full-document**.
- **Op-list walk** runs on `updateOne` / `updateMany` / `updateByPk` /
  `upsertOne` ops. Each `SetOp.values` is pipe-validated per-field; atomic op
  operands are not validated. The **set-only-validation rule**: only set-shape
  values are pipe-validated, because they describe the resulting field value
  directly. Atomic ops (`inc`, `mul`, `push`, etc.) describe a transformation;
  the resulting value depends on existing storage state which the schema
  doesn't own.
- **`assertNormalisedFilter(schema, q)`** runs on every `FilterGroup` filter
  arg. Enforces the **filter normalisation contract** (§11.6): field-existence
  invariant, op-closure invariant, logical-name invariant. No filter value
  validation.

### 7.3 Auto-bump (Q7.α)

**Auto-bump** is the implicit op-append behaviour for fields with `onUpdate`
generators on update calls. Two rules govern it:

- **onUpdate suppression rule.** If any user op (SetOp or atomic) touches a
  field, that field's `onUpdate` generator is suppressed for this update call.
- **Auto-bump injection.** For each schema field with `onUpdate` whose name is
  not in the **touched-fields set**, the framework appends an implicit
  `set({ <field>: <onUpdate()> })` op to the op list.

The **auto-bump validation rule**: auto-bumped SetOp values are pipe-validated
(same rule as user-supplied set values — generators can return invalid data;
the framework catches that).

### 7.4 Field-conflict rejection

**Field-conflict rejection rule.** If an update has multiple ops touching the
same field (e.g. `set({views: 0})` + `inc(views, 1)`), the framework throws at
the boundary. Cross-kind conflicts (e.g. `unset(x)` + `push(x)`) also throw.

Rationale: order-dependent semantics across adapters (Mongo / PG / Firebase
apply set+inc in different orders) is exactly the silent inconsistency the
framework bans. Conflicts are almost always bugs; loud failure beats a wrong
number in production. Users wanting sequential semantics use two calls inside
`session()`.

### 7.5 Collect-all rule and OrmValidationError

The **collect-all rule**: when validation finds errors, the framework
accumulates them across the input (multiple rows in `insertMany`, multiple ops
in update calls) and throws a single error at the end — never fail-fast on the
first.

`OrmValidationError extends EquippedError` is the error class for all
Repo-entry boundary throws. It has a `kind` discriminant for programmatic
classification:

```ts
class OrmValidationError extends EquippedError {
  kind: 'validation' | 'conflicting-ops' | 'empty-group' | 'undeclared-op' | 'upsert-filter-incompatible'
  schema: string
  operation: 'insertOne' | 'insertMany' | 'updateOne' | 'updateMany' | 'updateByPk' | 'upsertOne'
  failures: Array<{
    opIndex?: number
    rowIndex?: number
    field?: string
    cause: PipeError
  }>
}
```

Each entry in `failures` is a **failure entry**. The `kind` field is the
**error kind**. Users catch `OrmValidationError` for boundary-specific
handling, or `EquippedError` for any package-thrown error.

### 7.6 Validation pipelines

The **update-validation pipeline** runs in order on every update call:

1. Walk ops to build the touched-fields set.
2. Inject auto-bump ops for un-touched `onUpdate` fields.
3. Check for field conflicts (across user ops + auto-bump ops).
4. Pipe-validate all SetOp values.
5. Run `assertNormalisedFilter` on the filter arg.
6. Hand off to the adapter.

Errors are collected throughout; one `OrmValidationError` is thrown at the end
if any failures were collected.

The **insert-validation pipeline** runs `validateInsert` per document, collects
all failures across documents, and throws one `OrmValidationError` if any.

---

## 8. Transactions & sessions

### 8.1 Session contract

The **session method** is `repo.session<T>(fn: () => Promise<T>): Promise<T>`.
The **session contract**:

- The **session callback** runs inside a transaction.
- **Return-to-commit rule.** Successful return commits the transaction;
  `session(fn)` resolves with the callback's return value.
- **Throw-to-rollback rule.** Any uncaught throw in the callback rolls back
  the transaction; `session(fn)` rejects with the same throw.
- **No-explicit-rollback rule.** There is no `tx.rollback()` API. Rollback is
  triggered exclusively by throwing.
- **Sentinel rollback pattern.** Users wanting silent rollback throw a
  sentinel error and catch it outside `session()`. One mechanism, idiomatic
  JS.

### 8.2 Tx-context propagation

**Tx-context propagation** is the adapter's mechanism for routing methods to
the active tx connection during a session. The **adapter-owned tx propagation
rule**: tx-context propagation lives entirely inside the adapter, not in the
framework. The library never imports `node:async_hooks` (see also the zero-ALS
rule, §6.4).

A **tx-aware adapter method** is one that, on entry, checks for an active
session context and routes through the tx connection if one exists; otherwise
it grabs from the pool. **Every adapter method must be tx-aware.** The adapter
is free to use Node ALS, runtime equivalents on edge platforms (Workers'
tx-per-request, Deno's runtime, etc.), or any other mechanism.

### 8.3 Cross-schema session rule

**Cross-schema session rule.** All schema-per-call methods inside one session
share one tx, automatically. Because a single Repo handles all schemas
(single-Repo rule, §6.7), every `repo.<method>(schema, ...)` call inside
`session(fn)` routes through the same adapter — which tx-binds them via
adapter-internal tx-context propagation.

Combined with §6.6 (scope-session composition): tenant scopes and sessions
compose. A tenant scope wrapping a session applies the tenant transform to
every query inside, while the session keeps every query on the same tx
connection.

### 8.4 Nested sessions

**Adapter-defines-nesting rule.** A `repo.session(...)` inside another
`repo.session(...)` is delegated to the adapter. The framework calls
`adapter.transactional.session(fn)` again; the adapter decides its own nesting
behaviour (PG savepoints, Mongo subtransactions, Firebase no-ops or rejection).

The **nesting documentation contract**: adapter authors must document their
nesting behaviour in the adapter's README.

### 8.5 Isolation

**DB-default isolation rule.** Each adapter uses whatever default level its
`BEGIN` (or equivalent) implies — PG: `READ COMMITTED`; MySQL InnoDB:
`REPEATABLE READ`; SQLite: `SERIALIZABLE`; Mongo 5.0+: snapshot. There is no
`isolation` argument on `session(fn)`.

Inconsistent across adapters by design; the same behaviour every other JS ORM
has. Users needing specific isolation use the **isolation escape**:
`raw('BEGIN ISOLATION LEVEL ...')` or adapter-specific session config.

### 8.6 Session return-value rule

`session<T>(fn): Promise<T>` returns the callback's return value after a
successful commit. If commit fails (e.g. serialization error, deadlock retry
exhaustion), `session` rejects with the commit error rather than the callback's
return value. The **session return-value rule** locks both the success and
commit-failure cases.

### 8.7 What's not in the model

- **No-tx-argument rule.** The session callback signature is
  `() => Promise<T>`, not `(tx) => Promise<T>`. The active tx flows through
  adapter-internal context, not through an argument.
- **Single-DB-tx-only rule.** No two-phase commit, distributed transactions,
  or saga primitives. Single-DB transactions only.
- **No-session-options rule.** No `session(fn, options)` overload. Covers
  isolation, retry, deadlock strategy, nesting policy — all out of scope.

---

## 9. Relations

Relations live in a separate artifact from the schema (§1.2). This section
covers the relation kinds, FK Field refs, the build-callback shape, and the
preload runtime.

### 9.1 Source schema, target schema, FK ownership rule

The **source schema** is the schema passed first to `defineRelations(SourceSchema, ...)`.
The **target schema** is the schema being related to.

The **FK ownership rule**: `hasMany` and `hasOne` have the FK on the target
schema; `belongsTo` has the FK on the source schema. This drives the
per-kind builder shape — `hasMany`/`hasOne` infer the target from the FK
Field's parent, while `belongsTo` requires an explicit target argument.

### 9.2 Field<T,N,S> and the Field-only-FK rule

The **phantom parent-schema parameter** `S` on `Field<T, N, S>` carries the
parent schema at the type level with zero runtime cost:

```ts
class Field<T = unknown, Name extends string = string, S extends AnySchema = AnySchema> {
  declare readonly __valueType?: T
  declare readonly __schema?: S      // phantom; type-only
  readonly name: Name
  readonly path: readonly string[]
}
```

A Field returned by a schema's `fields` accessor is a **schema-tagged Field** —
its `S` parameter is the parent schema. The schema is "tagged" onto the Field
at the type level via the phantom parameter.

The **Field-only-FK rule**: FK refs in `defineRelations` must be `Field<T, N, S>`
refs from the relevant schema's `fields` accessor — not raw string keys. A
string FK pointing at a number PK is now a compile error; the **FK-PK type-match
guarantee** flows from this rule.

### 9.3 Source-bound build callback

The build callback for `defineRelations` has the shape `(rel, src) => ...` —
a **source-bound build callback**. The `src` parameter is the **source binding**
— a binding to the source schema for callback-local reference, so the source
schema is named only once (at the `defineRelations` call):

```ts
const UserRels = defineRelations(UserSchema, (rel, src) => rel
  .hasMany('posts', PostSchema.fields.userId)
  .belongsTo('org', src.fields.orgId, OrgSchema)
)
```

The `rel` parameter is the (Relations) builder.

### 9.4 Per-kind builder shapes

```ts
hasMany<K extends string, T extends AnySchema, FK extends Field<any, any, T>>(
  name: K extends keyof R ? never : K,
  fk: FK,
)

hasOne<K extends string, T extends AnySchema, FK extends Field<any, any, T>>(
  name: K extends keyof R ? never : K,
  fk: FK,
)

belongsTo<K extends string, FK extends Field<any, any, S>, T extends AnySchema>(
  name: K extends keyof R ? never : K,
  fk: FK,
  target: T,
  references?: Field<any, any, T>,
)
```

- `hasMany(name, fk)` and `hasOne(name, fk)` use **FK-driven target inference**:
  the target schema `T` is inferred from the FK Field's phantom parent
  (`Field<any, any, T>`), so the user only passes the FK Field. The kind
  difference between `hasMany` and `hasOne` is purely cardinality on the
  result type.
- `belongsTo(name, fk, target, references?)` requires an explicit target
  because the FK is on the source (its phantom parent is `S`, not the
  target). The optional `references` is the **references field** — the field
  on the target that the FK references; defaults to the target's PK Field.

### 9.5 Self-referential relations

A **self-referential relation** is a relation to the same schema as the source
(e.g. `User.manager → User`). It works without special-casing — pass the same
schema as both source and target:

```ts
const UserRels = defineRelations(UserSchema, (rel, src) => rel
  .belongsTo('mgr', src.fields.managerId, UserSchema)
)
```

### 9.6 Schema relations-agnosticism rule

**Schema relations-agnosticism rule.** The Schema artifact contains no
relational information. There is no `.references()` chain on `.field()`, no
FK→target hint on the schema declaration. All relational concerns live in the
Relations artifact. This avoids cyclic forward-reference problems that inline
declarations would force in JS without macros.

### 9.7 Many-to-many (explicit join schemas)

**Explicit-join rule.** Many-to-many is modelled with explicit **join schemas**
— a third schema that joins two others. There is no `manyToMany` or
`hasManyThrough` sugar.

```ts
const PostTagSchema = defineSchema('post_tags', (s) => s
  .pk('id', v.string(), () => 'pt-id')
  .field('postId', v.string())
  .field('tagId', v.string())
)

const PostRels = defineRelations(PostSchema, (rel, src) => rel
  .hasMany('postTags', PostTagSchema.fields.postId)
)

const PostTagRels = defineRelations(PostTagSchema, (rel, src) => rel
  .belongsTo('post', src.fields.postId, PostSchema)
  .belongsTo('tag', src.fields.tagId, TagSchema)
)
```

Users access tags from a post via a **two-step preload** (`post.postTags[].tag`).
No sugar exists because join schemas frequently carry their own data
(`created_at`, role on a `user_roles` join). Sugar that hides the join schema
obscures this; the explicit form keeps the join as a first-class entity.

### 9.8 Preloads

**Preload** is the framework-side mechanism for loading related documents:
`findMany(schema, q, { preload: [UserRels.posts, ...] })`.

**Package-side preload.** Preloads run package-side via `findMany` against any
queryable adapter. Cycle detection, max depth, and N+1 dispatch all live in the
package. Server-side joins (PG `JOIN`, Mongo `$lookup`) are out of scope; users
go through `raw`.

Vocabulary:

- **Cycle detection** stops infinite preloading via cyclic relations.
- **Max preload depth** is the per-request limit on preload chain depth.
- **Batched dispatch** is the framework batching N child queries into one
  `findMany(schema, q.in(fk, parentIds))` call (avoids N+1).
- **Preload context-flow rule.** Preloads honour `ContextSource` transforms
  (§6) — every preload sub-query goes through the same per-query config
  resolution pipeline as the top-level query. Tenant prefixes etc. flow
  through preloads automatically.

---

## 10. Update operations

### 10.1 UpdateOp<S, A>, op variants, op kind

`UpdateOp<S, A>` is the discriminated-union TS type that represents a single
update op at the type level. Each branch of the union is an **op variant**:
`SetOp<S>`, `IncOp<S>`, `MulOp<S>`, `MinOp<S>`, `MaxOp<S>`, `UnsetOp<S>`,
`PushOp<S>`, `PullOp<S>`, `PatchOp<S>`. Each variant has a **op kind**
discriminant — a `kind: 'set' | 'inc' | ...` field — that names the op.

```ts
interface SetOp<S>   { kind: 'set';   values: Partial<SchemaInput<S>> }
interface IncOp<S>   { kind: 'inc';   field: NumericFieldOf<S>; value: number }
interface MulOp<S>   { kind: 'mul';   field: NumericFieldOf<S>; value: number }
interface MinOp<S>   { kind: 'min';   field: ComparableFieldOf<S>; value: unknown }
interface MaxOp<S>   { kind: 'max';   field: ComparableFieldOf<S>; value: unknown }
interface UnsetOp<S> { kind: 'unset'; field: OptionalFieldOf<S> }
interface PushOp<S>  { kind: 'push';  field: ArrayFieldOf<S>; value: unknown | unknown[] }
interface PullOp<S>  { kind: 'pull';  field: ArrayFieldOf<S>; value: unknown | unknown[] }
interface PatchOp<S> { kind: 'patch'; field: ObjectFieldOf<S>; value: Partial<unknown> }
```

`UpdateOp<S, A>` resolves a variant to the variant type if `A['updateOps']`
includes the kind, and to `never` otherwise — per-op gating (§3.5).

### 10.2 Op helpers, helper-kind parity, narrowed-out helpers

**Op helpers** are user-facing functions that construct op variants. Imported
from `equipped/orm`:

```ts
import { set, inc, mul, min, max, unset, push, pull, patch } from 'equipped/orm'
```

The **helper-kind parity rule**: each op helper's name is identical to the
corresponding op kind literal (`set` helper produces `kind: 'set'`). Instance
of the broader name-parity rule (§4.1).

A **narrowed-out helper** is an op helper that produces a `never` type because
the adapter doesn't declare its op kind. Calling it is a compile error — same
mechanic as narrowed-out methods (§3.4), at the helper layer.

### 10.3 Field-category constraints

Each op variant constrains which fields it accepts via field-category type
helpers:

| Helper | Accepted fields | Used by |
|---|---|---|
| `NumericFieldOf<S>` | numeric fields | `IncOp`, `MulOp` |
| `ComparableFieldOf<S>` | comparable fields | `MinOp`, `MaxOp` |
| `OptionalFieldOf<S>` | optional fields | `UnsetOp` |
| `ArrayFieldOf<S>` | array fields | `PushOp`, `PullOp` |
| `ObjectFieldOf<S>` | object fields | `PatchOp` |

The **field-category constraint rule** locks this asymmetry: each op-variant's
field arg is constrained to fields of a specific category.

`SetOp<S>` accepts a **set-payload** — `Partial<SchemaInput<S>>` — and
constrains values per-field via the schema's pipes.

### 10.4 Set ops vs atomic ops

A **set op** (`SetOp<S>`) describes the resulting field value directly. Its
values are pipe-validated.

**Atomic ops** (`inc`, `mul`, `min`, `max`, `unset`, `push`, `pull`, `patch`)
describe a transformation; the adapter applies the op as one storage
operation. Their operands are not pipe-validated, because the resulting value
depends on existing storage state which the schema doesn't own.

This asymmetry is the **set-only-validation rule** (§7.2).

### 10.5 Op-list-shape rules

- **Non-empty op-list rule.** `update*` signatures require ≥1 op via
  `op0: UpdateOp<S, A>, ...rest: UpdateOp<S, A>[]`. An update with no ops is a
  compile error.
- **Field-conflict rejection rule** (§7.4). Same field touched by multiple ops
  → throws at the boundary.
- **Op-order-irrelevance rule.** Op-list order is irrelevant (follows from
  field-conflict rejection — no field is touched twice, so order can't
  matter). Contributors must not write code that depends on op order.

The `[op0, ...rest]` array passed to a single update call is the **op list**.

### 10.6 The `equipped/orm` export rule

Every member of the canonical update-op set has a corresponding op helper
(§10.2). There are no gating-only ops — method-shape capabilities (e.g.
`upsertOne`) are gated on behaviour-method presence, not on `updateOps`
membership.

Op helpers are exported top-level from `equipped/orm`. Users who collide with
JS built-in `Set` rename on import (`import { set as setOp } from 'equipped/orm'`).
The package does not provide an `ops.*` namespace.

---

## 11. Filter / FilterGroup

Filter args to Repo methods are `FilterFactory` callbacks (`q => q.eq(...).and(...)`).
The package guarantees a normalisation contract on the `FilterGroup` before
handing it to the adapter.

### 11.1 Filter-tree vocabulary

- **`FilterGroup`** is the runtime tree class.
- A **filter group** is one branch in the tree.
- A **filter clause** is one leaf in the tree — a `Filter` instance with
  `field`, `op`, `value`. The class is named `Filter`.
- The **filter tree** is the whole tree (a top-level `FilterGroup` with all
  its branches and leaves).

### 11.2 FilterFactory callback

A `FilterFactory` is the callback type passed to filter-based Repo methods.
The callback receives an empty `FilterGroup` — the **filter root** — builds it
up via filter-op methods and structural combinators, and returns it. Prose
term: **filter callback**.

```ts
type FilterFactory = (q: FilterGroup) => FilterGroup
```

### 11.3 Filter-op methods and structural combinators

`FilterGroup` exposes one method per filter op (§4.1) — these are the
**filter-op methods** (`eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `notIn`,
`like`, `exists`, `notExists`, `contains`, `notContains`).

It also exposes **structural combinators**: `and(facFns)` and `or(facFns)`.

- **Combinators-always-available rule.** `and` and `or` are always available
  on any `FilterGroup`, regardless of `queryableOps` declarations. They build
  sub-tree structure, not field-ops; the per-op gating rule (§3.5) applies to
  filter ops only.
- **Empty-combinator rejection rule.** `and([])` and `or([])` throw at the
  moment `FilterGroup.and([])` / `FilterGroup.or([])` is called — at builder
  time, not at the boundary. The stack trace points at the offending call.
  `FilterGroup` is well-formed by construction; the boundary doesn't need to
  recheck.

### 11.4 Logical names and physical mapping

`Filter.field` carries the **logical field name** — the schema-declared field
name (`field.name` if a `Field<T>` ref was passed; raw string verbatim
otherwise).

The adapter is responsible for **physical mapping**: `id` → `_id`, snake_case
columns, document-path conversion, etc. The package boundary uses logical
names; the adapter translates to physical names before issuing the query.

### 11.5 Raw-string field overload

The **raw-string field overload escape rule**: filter-op methods accept either
a `Field<T>` ref (typed) or a raw string field name (untyped — `T` collapses
to `unknown`). The string form is an escape hatch for dynamic queries; users
who pass wrong-typed values bypass the TS contract, and the wrong-typed value
flows through to the adapter as-is (the package does not coerce filter
values — see no-runtime-value-coercion below).

### 11.6 Filter normalisation contract

`assertNormalisedFilter(schema, q)` runs at the Repo-entry boundary on every
filter arg. The **filter normalisation contract** has six **normalisation
invariants** — three enforced and three inverted (the package guarantees it
does NOT do them):

| Invariant | Name | Enforced or inverted |
|---|---|---|
| A | **field-existence invariant** | enforced (every `Field<T>`-resolved name must exist in the schema; unknown names rejected at boundary) |
| B | **op-closure invariant** | enforced for free (filter ops are an enum) |
| C | **no-runtime-value-coercion invariant** | inverted (the package does not run pipes on filter values; type-only contract) |
| D | **no-tree-flattening invariant** | inverted (the adapter receives the tree shape verbatim) |
| E | **empty-combinator rejection invariant** | enforced at builder time (preempted before reaching the boundary) |
| F | **logical-name invariant** | enforced (`Filter.field` is the schema-declared field name; physical mapping is adapter responsibility) |

### 11.7 No-FilterGroup-raw rule

There is no `FilterGroup.raw(...)` filter-shape escape hatch. Custom
adapter-specific filter shapes go via the adapter's `raw(...)` method
(Repo-level), not via the FilterGroup tree. The **no-FilterGroup-raw rule**
locks this — consistent with the no-emulation rule (§3.5) and the closed-set
rule (§4.4).

### 11.8 Filter-tree clone

`FilterGroup.clone()` deep-clones the tree, including `structuredClone` of
values, so callers can safely mutate the result.

---

## 12. Upsert

`upsertOne` is a filter-based Repo method gated by `queryable.upsertOne`
declared on the adapter.

### 12.1 API shape

```ts
await repo.upsertOne(UserSchema,
  q => q.eq(UserSchema.fields.email, 'a@b.com'),
  { name: 'Alice', email: 'a@b.com' },
  set({ lastSeen: Date.now() }),
  inc(UserSchema.fields.loginCount, 1),
)
```

Three argument roles:

- The **filter callback** (the `q => ...` arg). See §11.
- The **insert payload** (`{ name, email }`). The **full-insert-payload rule**
  locks this as `SchemaInput<S>` (full document, same as `insertOne`), not
  `Partial`.
- The **op list** (`set(...)`, `inc(...)`). See §10.

### 12.2 Gate rule

**Upsert gate rule.** `upsertOne` exists when `queryable.upsertOne` is
declared on the adapter. Missing → narrowed-out. Symmetric with every other
filter-based Repo method (§5.1) — gate is behaviour-method presence, no
separate capability flag.

`queryable.upsertOne` requires `queryableOps` to be non-empty (co-required
pair, §3.3) and accepts the adapter's declared `updateOps` for its op-list
arg. Both flow through the existing `queryable` machinery; no upsert-specific
declaration exists.

The **query-only-upsert rule**: there is no `upsertByPk` variant. Real-world
upserts identify by natural key (email, slug, FK), not PK. PK-keyed upsert is
expressible as `q.eq(schema.pkField, pk)` if needed.

The **upsert-in-queryable rule**: `upsertOne` lives in the `queryable`
behaviour, not `crud`. Important for adapter authors.

### 12.3 Dual-path semantics

`upsertOne` has two execution paths depending on whether the row exists:

- **Insert-then-ops semantics.** Row missing: validate the insert payload via
  `insertOne` rules (`onCreate` defaults injected), insert it, then apply
  atomic ops on top. SetOp values override inserted fields; atomic ops apply
  to the inserted values (e.g. `inc(views, 1)` on insert with `views: 0` →
  `views: 1`).
- **Update-only-on-exists semantics.** Row exists: ignore the insert payload
  entirely; apply ops to the existing row. The Q7.α auto-bump rule applies on
  this path — fields with `onUpdate` not touched by user ops get implicit
  `set` ops.

The pair together is **upsert dual-path semantics**.

The **upsert auto-bump rule**: auto-bump (§7.3) applies on the update path of
upsert. Fields with `onUpdate` not in the touched-fields set get implicit
`set({ <field>: <onUpdate()> })` ops.

The **upsert insert-vs-op conflict rule**: an extension of the field-conflict
rejection rule (§7.4). If the insert payload sets `views: 0` AND an op
`inc(views, 1)` is also passed, the framework throws (because in the
row-missing case both touch `views`).

### 12.4 Upsert-compatible filter

Not every adapter can implement upsert against arbitrary filter shapes. An
**upsert-compatible filter** is a filter shape an adapter can natively turn
into an upsert.

**Upsert-filter incompatibility error.** If the adapter receives a filter
shape it can't upsert against, it throws an `OrmValidationError` with
`kind: 'upsert-filter-incompatible'` at the adapter boundary, naming the
filter shape it received and what it requires.

The **upsert-filter documentation contract**: adapter authors must document
their upsert-compatible filter shapes in the adapter's README.

Cross-adapter compatibility table (informational; adapter implementations
must match):

| Adapter | Upsert-compatible filter |
|---|---|
| MongoDB | Any filter (native `findOneAndUpdate` with `upsert: true`) |
| PostgreSQL | Single `eq` on a UNIQUE-indexed column (compiles to `ON CONFLICT (col) DO UPDATE`) |
| SQLite | Same as PG |
| Firebase | Single `eq` on the PK field (compiles to `setDoc(ref, ..., { merge: true })`) |

### 12.5 Bulk upsert and other exclusions

**Single-document upsert rule.** `upsertMany` is not supported. Single-document
upsert only. Bulk find-or-create requires adapter-specific implementations
(Mongo `bulkWrite`, PG bulk `ON CONFLICT`); users go through the adapter's
`raw` method.

Bulk upsert is **out of scope** for the framework, distinct from deferred (see
§14).

### 12.6 Return value and what's not in the model

**Upsert-returns-document rule.** `upsertOne` always returns the resulting
document, whether created or updated. The two paths are not distinguishable
from the return value.

- **No-creation-discriminator rule.** The return value is just the document.
  There is no `{ document, created: boolean }` shape.
- **Empty-ops-allowed-on-upsert rule.** `upsertOne(schema, q, insert)` with no
  ops is allowed — it's "upsert this; if it exists do nothing." This is
  distinct from the non-empty op-list rule (§10.5) for `update*`, where the
  ops are the only thing the call does.

---

## 13. Cross-cutting principles

A **principle** is a rule that constrains code in three or more layer-sections
of this document, or is a fundamental non-goal. Layer-local rules stay in
their layer-section. The **spans-three-sections rule** is the admission
criterion: a rule earns a place here if it crosses three or more sections.

| # | Principle | Statement |
|---|---|---|
| 1 | **Builder-chain rule** | Builder-chain factories are the default for all artifact construction; direct calls for invocation/operations. (§2.2) |
| 2 | **No-emulation rule** | The framework never emulates a missing op or behaviour client-side. Adapter-specific power lives in the adapter's `raw` method only. (§3.5) |
| 3 | **Closed-set rule** | Adapters subset the canonical sets (filter ops, update ops, field types, relation kinds); they cannot extend them. Extension requires a package version bump. (§4.4) |
| 4 | **Type-system-is-the-contract rule** | Capability mismatches are compile errors wherever feasible, not runtime throws. The TypeScript surface is the load-bearing contract. |
| 5 | **Validate-once rule** | Validation runs exactly once, at the Repo-entry boundary; adapters receive validated input and never re-validate. (§7.1) |
| 6 | **Always-throw-never-silently-drop rule** | Empty filter groups, missing fields, unknown ops, conflicting ops fail loudly. No silent short-circuits, no "match-all" / "match-none" fallbacks at boundaries. |
| 7 | **No-runtime-value-coercion rule** | Filter values are a TS-only contract. The framework does not run pipes on filter values. (§11.6 invariant C) |
| 8 | **Zero-ALS rule** | The library imports zero `node:async_hooks` and never enters or runs ALS scopes. User-owned scope-entry only. (§6.4) |
| 9 | **Adapter-owned tx propagation rule** | Tx-context propagation lives entirely inside the adapter, not in the framework. (§8.2) |
| 10 | **Schema relations-agnosticism rule** | Schemas contain no relational information. All relational concerns live in the Relations artifact. (§9.6) |
| 11 | **Single-Repo rule** | A Repo handles all schemas it can compatibility-narrow against. No registry, no per-Repo derivation, no per-schema typed Repos. (§6.7) |

---

## 14. Out of scope

Out-of-scope items are decided-against, not "future work." There is no
**deferred** bucket — the **no-deferred bucket rule**: every concept either has
a locked design or is out of scope.

The **out-of-scope revisit policy**: items are revisited only when a real,
in-tree user need surfaces with no acceptable workaround through `raw`.
Speculative additions (e.g. "someone might want bulk upsert someday") are
rejected. The bar for promotion is concrete, not speculative.

| # | Out-of-scope item | Statement | Escape |
|---|---|---|---|
| 1 | **Composite foreign keys** | Multi-column FKs not supported. Single FK only. | Surrogate UUIDs + composite UNIQUE indexes; `raw` for genuine cases. |
| 2 | **Composite primary keys** | Multi-column PKs not supported. Single PK only. | Same as composite FKs. |
| 3 | **`'binary'` field type** | Binary blobs (Uint8Array / Buffer) not in the canonical field-type set. | Encode as base64 string; or `raw`. |
| 4 | **`'bigint'` field type** | Arbitrary-precision integers not in the canonical field-type set. | Encode as string; or `raw`. |
| 5 | **Bulk upsert** | `upsertMany` not supported. Single-document upsert only. | `raw` (Mongo `bulkWrite`, PG bulk `ON CONFLICT`). |
| 6 | **Adapter-typed extensions** | Adapter-contributed typed namespaces on the Repo (e.g. `repo.pg.fts`) not supported. | Adapter's `raw` method. |
| 7 | **Migrations / DDL** | Schema migration, table creation, DDL operations out of scope. | User-managed (dedicated migration tools); `raw` for ad-hoc DDL. |
| 8 | **Aggregates** | `count` / `sum` / `avg` / `groupBy` out of scope. | `raw`. |
| 9 | **Streaming / change-feeds** | Cursor streaming, Mongo change streams, Firebase realtime listeners out of scope. | `raw`. |
| 10 | **Server-side joins** | Joined queries (`findManyJoined`, PG `JOIN`, Mongo `$lookup`) out of scope. Preloads run package-side via `findMany`. | `raw`. |
| 11 | **Per-field adapter config** | Per-field adapter-specific config (PG types, Mongo index hints) out of scope. | None — accept the constraint or use `raw`. |
| 12 | **Schema-side adapter binding** | Schemas are fully adapter-agnostic; binding to an adapter happens at Repo construction. No `Schema.boundTo(Adapter)`. | Adapter binding is a Repo concern; use multiple Repos for schemas needing different adapters. |
| 13 | **Two-phase commit / distributed tx / sagas** | XA, 2PC, saga primitives out of scope. Single-DB transactions only. | None. |
| 14 | **Session options** | `session(fn, options)` overload not supported (covers isolation, retry, deadlock, nesting). | None for retry/deadlock; `raw('BEGIN ISOLATION LEVEL ...')` for isolation. |
| 15 | **Query-level isolation** | No `isolation` arg on `session()`. Each adapter uses its DB's default. | `raw('BEGIN ISOLATION LEVEL ...')` or adapter-specific session config. |
