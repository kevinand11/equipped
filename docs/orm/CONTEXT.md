# Equipped ORM — Context

This document is the long-lived reference for the ORM in `equipped`. It defines
the canonical vocabulary used across the ORM, the rules that govern every layer,
and the items that are explicitly out of scope.

The ORM is a typed, capability-aware Repo over adapters. The package ships a
small set of in-tree reference adapters (in-memory, json, postgresql,
mongodb); production targets it doesn't cover are user-supplied. The
conceptual stack is **Schema → Relations → Adapter → Repo**, with Repo
construction taking a base resolver and an optional runtime override stack
for per-query config transforms (`repo.resolve(transform, fn)`). The
TypeScript type system narrows the Repo's surface to exactly what the adapter
declares it can do; any mismatch is a compile error, not a runtime throw.
Validation runs once, in the package, at the Repo-entry boundary; the adapter
is handed validated input.

Each section below is the canonical reference for one layer or cross-cutting
concern. Sections 13 and 14 cover principles and explicit non-goals.

---

## 1. Definitions (the four artifact kinds)

The ORM has exactly four top-level **definitions**. Each is constructed by a
static factory method `X.from(args)` that returns a builder, terminated by
`.build()` (the **builder-chain rule** — see §2).

### 1.1 Schema

A **Schema** is a typed description of a single document shape — its name, its
PK field, its data fields, and any computed fields. A Schema is
adapter-agnostic and relations-agnostic; it carries valleyed pipes for
validation and TypeScript types for compile-time inference.

A Schema is **not** a table, a collection, a model class, a row object, or an
instance. It is not bound to a database. It is not aware of relations. It is
not aware of adapters.

```ts
const UserSchema = Schema.from('users')
  .pk('id', v.string(), () => crypto.randomUUID())
  .field('email', v.string())
  .field('age', v.number())
  .field('createdAt', v.number(), { onCreate: () => Date.now() })
  .field('updatedAt', v.number(), { onUpdate: () => Date.now() })
  .build()
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
intentional: a single `Relations.from(...)` call declares multiple relations,
so the artifact is *a Relations* (singular noun, plural form).

Relations are **not** part of the schema, **not** enforced by the database (no
DDL), and **not** automatically bidirectional. A `User → posts` `hasMany` does
not imply `Post → user` `belongsTo`; both must be declared if both are wanted.

```ts
const UserRels = Relations.from(UserSchema)
  .hasMany('posts', PostSchema.fields.userId)
  .belongsTo('org', UserSchema.fields.orgId, OrgSchema)
  .hasOne('profile', ProfileSchema.fields.userId)
  .build()
```

Vocabulary:

- A **relation** is one entry inside a Relations (e.g. `UserRels.posts`).
- The three **relation kinds** are `hasMany`, `hasOne`, `belongsTo`.
- The **source schema** is the schema passed first to `Relations.from(...)`;
  the **target schema** is the schema being related to.
- See §9 for full Relations vocabulary.

### 1.3 Adapter

An **Adapter** is a class — a subclass of the abstract `OrmAdapter` base —
that the framework instantiates and calls to talk to a specific database.
Adapters are typically bound to a specific database driver/SDK. The package
ships a small set of in-tree reference adapters (in-memory, json, postgresql,
mongodb); production targets the package doesn't cover are user-supplied.

An Adapter is **not** a builder (Schema, Relations, and Repo are; Adapter is
not — see §2.2 for the carve-out). It is **not** a connection (the connection
client is an instance field on the adapter). It is **not** a Repo (Repo wraps
an adapter instance; an Adapter doesn't know about Repo).

Each adapter class is constructed via the package-level `configurable(pipe, Base)`
primitive (`src/utilities/configurable.ts`): it extends `configurable(connectionPipe, OrmAdapter)`,
so the `connectionPipe` validates the connection-level config at
`MyAdapter.create(rawConfig, ...extras)`, and the validated value is exposed
as `this.config` (typed via the phantom `typeof MyAdapter.Config` marker).
Per-call schema-level config is declared separately as a required
`readonly schemaConfigPipe` on the adapter — see §6.1 (two-tier config
split).

```ts
const mongoConnectionPipe = () => v.object({
  uri: v.string(),
  // ...other connection-level fields
})

export class MongoAdapter extends configurable(mongoConnectionPipe, OrmAdapter) {
  readonly schemaConfigPipe = v.object({ db: v.string(), col: v.string() })

  readonly queryableOps = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'like', 'exists', 'notExists', 'contains', 'notContains'] as const
  readonly updateOps = ['set', 'inc', 'mul', 'min', 'max', 'unset', 'push', 'pull', 'patch'] as const
  readonly supportedFieldTypes = ['string', 'number', 'boolean', 'null', 'object', 'array', 'date'] as const

  #client: MongoClient
  protected constructor(config: typeof MongoAdapter.Config, options?: MongoOptions) {
    super(config)
    this.#client = new MongoClient(config.uri, options)
  }

  async connect()    { await this.#client.connect() }
  async disconnect() { await this.#client.close() }

  async findByPk(schema, schemaCfg, pk)        { /* ... */ }
  async createMany(schema, schemaCfg, data)    { /* ... */ }
  async findMany(schema, schemaCfg, filter, options?) { /* ... */ }
  async session<T>(fn: () => Promise<T>)       { /* ... */ }
  // ...optional methods the adapter chooses to implement
}

const adapter = MongoAdapter.create({ uri: 'mongodb://...' })
```

Vocabulary:

- The Adapter has two kinds of named parts: **methods** (flat optional
  instance methods on `OrmAdapter`: `connect`, `disconnect`, `findByPk`,
  `createMany`, `updateByPk`, `deleteByPk`, `raw`, `findMany`, `updateMany`,
  `deleteMany`, `upsertOne`, `session`) and **capability declarations**
  (literal-typed `readonly` instance fields: `queryableOps`, `updateOps`,
  `supportedFieldTypes`, plus the required `schemaConfigPipe`).
- The historical bag groupings (`lifecycle`, `crud`, `queryable`,
  `transactional`) survive **only as documentation labels** — see §3.1. They
  no longer carry runtime or type-system structure.
- Cross-cutting effects (e.g. `updateOps` gating ops on update methods) are
  described by their declaration.
- See §3 for the full Adapter surface vocabulary.

### 1.4 Repo

A **Repo** is the user-facing object built around an adapter and a base
resolver. A single Repo handles all schemas via the **schema-bound chain**
`repo.on(Schema)...` (see **schema-per-call**, §5.2).

A Repo is **not** per-schema (no `userRepo` / `postRepo` split). It is **not** a
connection. It is **not** a database client. It is **not** aware of
multi-tenancy directly — tenant context flows through `repo.resolve(transform,
fn)` (§6).

```ts
const repo = Repo.from(PostgresAdapter)
  .resolve((schema) => ({ table: schema.name }))
  .build()

await repo.on(UserSchema).one().id('u1').find()
await repo.on(UserSchema).all().where(q => q.gt(UserSchema.fields.age, 18)).find()
await repo.session(async () => {
  await repo.on(UserSchema).one().create({ ... })
  await repo.on(OrderSchema).one()
    .where(q => q.eq(OrderSchema.fields.id, 'o1'))
    .update({ ... })
})
```

Vocabulary:

- The **Repo surface** is the typed shape of `repo.on(Schema)`'s chain plus
  Repo-level methods (`session`, `resolve`).
- **schema-per-call** is the calling pattern (`repo.on(UserSchema).one().id('u1').find()`
  rather than `userRepo.one().id('u1').find()`).
- **`repo.on(schema)`** is the **schema-bound entry**: returns a `SchemaRef`
  that exposes per-schema chains (`one()`, `all()`, `raw(...)`).
- See §5 for the full Repo surface vocabulary.

### 1.5 Cross-artifact conventions

- The three **declarative-data artifacts** (`Schema`, `Relations`, `Repo`) are
  constructed via `X.from(args).step()...build()`. Each exports a static
  `.from(...)` factory that returns a builder; `.build()` is the explicit
  terminal step that returns the artifact instance. The fourth artifact —
  `Adapter` — is **behavioural** and uses the class-via-`configurable` form
  instead of a builder chain (see §2.2 carve-out and §1.3).
- Each `.from(...)` takes only its **constructor-essential** input(s):
  - `Schema.from(name)` — name positional
  - `Relations.from(source)` — source schema positional
  - `Repo.from(adapter)` — adapter positional
  Everything else (fields, FK descriptors, resolver) goes into builder steps.
  Adapters take the connection-config pipe as the first argument to
  `configurable(connectionPipe, OrmAdapter)`; everything else (capability
  declarations, methods, `schemaConfigPipe`) is class body.
- Pluralisation uses natural English plurals (`schemas`, `adapters`, `repos`).
  `Relations` is a singular noun in plural form; capitalise when ambiguous.
- The collective term for "things produced by `.from(...).build()`" is
  **definition**.

---

## 2. Builder-chain factory pattern

The pattern `X.from(args).step1().step2().build()` is the canonical shape for
all artifact construction in the package. This section locks the vocabulary
and rules of the pattern.

### 2.1 Vocabulary

- A **factory** is the static factory method (`Schema.from`, `Relations.from`,
  `Repo.from`). Calling it returns a **builder**. Adapter has no `.from` —
  it's class-via-`configurable` (§1.3, §2.2).
- The **builder** is the object returned by `.from(...)`. Each builder method
  returns a new builder whose accumulator type includes the declarations from
  prior steps.
- A **builder step** is a method on the builder (`.field()`, `.pk()`,
  `.computed()`, `.hasMany()`, `.belongsTo()`, `.resolve()`).
- The **terminal step** is `.build()` — the only step that returns the
  artifact instance. `.build()`'s availability is gated on the accumulator
  satisfying the artifact's prerequisites (§2.6).
- The **accumulator type** is the generic on the builder that grows as steps
  are called. Used to gate later steps and `.build()`.

### 2.2 Rules

- **Builder-chain rule.** Static-factory builder chains are the canonical
  shape for **declarative-data** artifact construction (Schema, Relations,
  Repo). New declarative-data artifacts follow `X.from(args).step1().step2().build()`;
  flat-object factories deferred unless a concrete reason to deviate.
  **Behavioural artifacts** (Adapter, plus package-level adapters in
  cache/jobs/events/server) use the class-via-`configurable` form instead —
  `class X extends configurable(pipe, Base) {...}` with a `protected constructor`
  and inherited `static create(input, ...args)`. The split is deliberate: a
  builder chain is the right tool for accumulating typed declarations
  (fields, FK descriptors, capability lists); a class is the right tool for
  encapsulating behaviour (instance state, methods, lifecycle). See ADR
  2026-05-06 for the decision and the alternatives considered.
- **Once-per-step rule.** Each builder step is callable at most once. Calling
  the same step twice is a compile error via the **uniqueness guard**
  (see §2.3).
- **Per-step coherence.** Later steps reference earlier accumulator state.
  Example: `.computed({...})`'s `deps` are constrained to prior `.field(...)`
  names. Violations fire at the offending call line, not at the end of the
  chain.
- **Rest-args convention.** Where a builder step takes a fixed-shape list,
  rest-args are preferred over array literals (mostly applicable to
  schema/relations builder steps; the analogous rule on Adapter classes is
  that capability arrays use `as const` literal types).
  Uses TS 5.0+ `const` type parameters
  (`<const Ops extends readonly OpName[]>`) to preserve literal types in
  rest-args without `as const`.
- **Omission-equals-empty rule.** A builder step not called means the
  artifact doesn't declare that capability. Op-list fields default to
  `readonly []`; absent steps default to absent. The same rule applies to
  Adapter classes — undeclared capability arrays default to `readonly []` on
  `OrmAdapter`; unimplemented methods stay undeclared.
- **Build-gated materialisation rule.** The artifact instance only exists
  after `.build()`. The builder is *not* the artifact; reading runtime methods
  off a non-built builder is a type error.
- **Clone-on-step rule.** Every builder step returns a *new* builder
  instance, not a mutated `this`. This applies uniformly across module-load
  artifact builders (`SchemaBuilder`, `RelationsBuilder`, `RepoBuilder`),
  filter sub-builders (`FilterGroup`), and per-call query builders
  (`OneBuilder`, `AllBuilder`). The reason is divergent reuse: a user holding
  a partially-built builder must be able to fan out from it
  (`const base = X.from(...).step1(...); const a = base.step2(p); const b = base.step3(q)`)
  without `a` and `b` polluting each other or the shared base. In-place
  mutation would break this. The cost is one allocation per step — small
  compared to the bug class it eliminates.

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

- **Schema-bound entry** (schema-per-call): `repo.on(schema)` — returns a
  `SchemaRef`, the entry point to the per-call query chain.
- **Session entry**: `repo.session(fn)`.
- **Runtime resolver override**: `repo.resolve(transform, fn)` — pushes a
  config transform for the duration of `fn` (§6).
- **Op helpers**: `set(...)`, `inc(...)`, etc. These construct operation
  values used as arguments to other calls; they are single-shot and a chain
  would add ceremony for no benefit.

The query chain itself (`repo.on(Schema).one().id(pk).find()`) is a
sub-pattern of the builder-chain rule — see §2.5.

### 2.5 Query builder and FilterFactory

The query chain `repo.on(Schema).one().id(pk).find()` (and its `.all()`
variant) is itself a builder chain — the **query builder** — terminated by
`.find()` / `.create()` / `.update()` / `.delete()` / `.upsert()` instead of
`.build()`. Steps like `.where()`, `.select()`, `.preload()`, `.orderBy()`,
`.limit()`, `.offset()` accumulate state; the terminal verb executes against
the adapter.

The `FilterFactory` callback `q => q.eq(...).and(...)` (see §11) is a
**filter sub-builder** on `FilterGroup`, used inside `.where(...)`. Same
vocabulary applies (steps, rest-args, etc.); the difference is what's being
constructed (filter trees) and the recursive nesting via `and([(g) => ...])`
/ `or([(g) => ...])`.

### 2.6 `.build()` prerequisites

Each artifact's `.build()` enforces accumulator prerequisites at the type
level. `.build()` is gated as `build(this: { _acc: SatisfiedAcc }): X` — if
the accumulator doesn't satisfy, `this` doesn't bind and TS errors at the
`.build()` call site.

| Artifact | `.build()` requires |
|---|---|
| `Schema` | `.pk(...)` was called (PK-less schemas have no meaning) |
| `Relations` | nothing enforced — empty Relations is a valid no-op |
| `Repo` | `.resolve(...)` was called (the only thing that produces a config) |

(Adapter is constructed via class-via-`configurable`, not a builder — see
§1.3. The equivalent prerequisite for an Adapter class is "extends
`configurable(connectionPipe, OrmAdapter)` and declares `schemaConfigPipe`,"
both enforced at the type level.)

---

## 3. Adapter surface & narrowing

This section describes the rules and vocabulary around the Adapter class's
methods and capability declarations, and how they narrow the Repo's surface.

### 3.1 Methods (and the historical bag groupings)

The Adapter exposes exactly twelve **optional methods** declared on the
abstract `OrmAdapter` base. Each subclass implements the ones it supports and
omits the rest:

| Method-group label | Methods (each independently optional) |
|---|---|
| `lifecycle` | `connect`, `disconnect` |
| `crud` | `findByPk`, `createMany`, `updateByPk`, `deleteByPk`, `raw` |
| `queryable` | `findMany`, `updateMany`, `deleteMany`, `upsertOne` |
| `transactional` | `session` |

The four group labels (`lifecycle`, `crud`, `queryable`, `transactional`)
survive **only as documentation** — they are vocabulary for discussing related
methods together. They are *not* runtime objects, *not* type-system bags, and
*not* required to be implemented as a unit. The methods themselves are flat
on the class. An adapter that implements `findByPk` and `raw` and nothing else
is a valid adapter (read-only PK-keyed access plus an escape hatch).

Many adapter targets (Firestore, DynamoDB, edge serverless drivers, in-memory
mocks, REST-API adapters) have no meaningful connect/disconnect — leaving
`connect`/`disconnect` unimplemented is silent and structural; no no-op stubs
required.

### 3.2 Capability declarations

A **capability declaration** is a literal-typed `readonly` instance field on
the Adapter that gates ops or field types. There are exactly four plus one
required pipe:

| Declaration | Canonical set | Gates |
|---|---|---|
| `queryableOps` | filter ops | which filter ops the adapter supports |
| `updateOps` | update ops | which update ops `update*` and `upsertOne` accept |
| `aggregateOps` | aggregate ops | which aggregator funcs `aggregate` accepts (§5.8) |
| `supportedFieldTypes` | field types | which schemas can pair with the adapter |
| `schemaConfigPipe` | (a valleyed pipe) | the per-call schema config's shape; validated at the Repo→Adapter boundary every query (§6.3) |

`queryableOps`, `updateOps`, `aggregateOps`, and `supportedFieldTypes` default
to `readonly []` on `OrmAdapter`; subclasses override with `as const` literal
arrays to declare what they support. `schemaConfigPipe` is **abstract** on
`OrmAdapter` — every adapter subclass must declare it.

`updateOps` is a value-level union of `AnyUpdateOp` variants the adapter
supports. It is not a capability registry — surface methods like `upsertOne`
are gated on method-presence, not on `updateOps` membership (§5.1, §12.2).

Each op-list declaration's values are drawn from a closed canonical set (§4).
Adapters **subset** the canonical set; they cannot add new members.

The Adapter's **connection config type** is *not* a capability declaration —
it flows from the `connectionPipe` argument to `configurable(connectionPipe, OrmAdapter)`,
exposed on each subclass as the phantom `static Config` type marker
(`typeof MyAdapter.Config`) and as the `this.config` instance property
(§1.3). The Repo's `.resolve(fn)` step (§6) returns the per-call **schema
config** (typed by `schemaConfigPipe`), not the connection config.

### 3.3 Surface narrowing and structural inference

The **Adapter surface** is the union of all methods and capability
declarations on the Adapter class. The Adapter **declares** a method or op
when it appears on the class (instance method present; literal-typed array
contains the op); an absent method or op is **undeclared**.

**Surface narrowing** is the process by which the Repo's typed methods are
reduced based on the Adapter's declarations. The result of narrowing is the
Repo surface; methods whose required method or op is undeclared are
**narrowed-out methods** — their type resolves to `never`, so calling them is
a compile error.

The mechanism is purely structural: the Repo's per-verb gates read off the
class's instance type via `keyof InstanceType<A>` (method presence) and
`A['queryableOps'][number]` / `A['updateOps'][number]` /
`A['supportedFieldTypes'][number]` (capability membership). There is no
accumulator, no explicit `capabilities: [...]` array, and no separate
"declared methods" registry. Presence on the class is the declaration.

The historical "co-required pair" between the `queryable` bag and a non-empty
`queryableOps` is **self-policing** under structural narrowing: if an adapter
implements `findMany` but leaves `queryableOps = []`, the filter chain
(`q.eq(...)` etc.) is unreachable type-wise (each filter-method is gated on
`'eq' extends queryableOps[number]`, which resolves to `never`), so
`findMany` is effectively narrowed-out at the consumer with no construction-
time check needed.

### 3.4 Per-op gating, parity, and the no-emulation rule

**Per-op gating** is the TypeScript-level mechanism by which an undeclared op
becomes a compile error. The op-list declarations (`queryableOps`, `updateOps`)
drive per-op gating; the field-type declaration (`supportedFieldTypes`) drives
schema-arg gating.

**Declaration-implementation parity** is the invariant that the type system
compile-errors on any mismatch between a declaration and its implementation
on the adapter class. The mechanism is structural method override: the
optional method signatures inherited from `OrmAdapter` constrain each
subclass's method bodies, so a misplaced parameter or wrong return type is
caught at the subclass definition site, not at the Repo dispatch site.
Implementation cannot exceed declaration; declaration cannot lack
implementation.

**No-emulation rule.** The framework never emulates a missing method or op
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
it; method-shape capabilities (e.g. `upsertOne`) are gated on method
presence on the adapter class, not by adding members to this set.

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

### 4.4 Canonical aggregate-op set

An **aggregate op** is one of:

```
count · countDistinct · sum · avg · min · max
```

The **lowercase-verb / camelCase-compound convention**: bare aggregator
functions are lowercase (`count`, `sum`, `avg`, `min`, `max`); compound
variants use camelCase (`countDistinct`, never `count_distinct` or
`countdistinct`). Future additions must respect this. `Sum`, `COUNT`,
`count_distinct`, `cnt` are all rejected by the convention.

Every member of the canonical aggregate-op set has a corresponding
`AggregateBuilder` step (§5.8) of the same name. The set is closed (§4.5) —
adapters subset it via `aggregateOps`. **Out-of-set aggregations** —
window functions (`row_number`, `rank`, `lag`, `lead`, `dense_rank`),
statistical aggregates (`stddev_pop`, `stddev_samp`, `variance`,
`percentile_cont`), set-builder aggregates (`array_agg`, `string_agg`,
`json_agg`), `FILTER (WHERE ...)` per-aggregate clauses, and grouping sets
(`ROLLUP`, `CUBE`) — are explicitly out of scope. They go through the
adapter's `raw` method.

The **alias-required rule**: every aggregator step takes a string literal
alias as its last argument; the alias is the output key in the result row
and the once-per-step uniqueness key (§2.3) preventing duplicate output
columns. There is no auto-aliasing.

### 4.5 Closed-set rule and extensions

**Closed-set rule.** Adapters subset the canonical sets. They cannot add new
filter ops, update ops, aggregate ops, field types, or relation kinds. Custom
adapter-specific power goes through the adapter's `raw` method only.

A **canonical-set extension** (adding a new member to one of the canonical
sets) is a maintainer-side process. The **canonical-extension contract**
requires:

- (a) the canonical type literal is added to the union;
- (b) the corresponding method or helper is added (filter ops get FilterGroup
  methods; update ops get op helpers; aggregate ops get AggregateBuilder
  steps; field types get FieldTypeOf branches);
- (c) at minimum, the in-memory adapter is updated;
- (d) all locked rules in §4.1–4.4 are respected (notX-prefix,
  lowercase-verb, camelCase-compound, JS-aligned naming, name-parity).

A canonical-set extension is a breaking change and requires a major-or-minor
package version bump per semver.

### 4.6 Out-of-scope field types

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

### 5.1 Repo surface and gated chain verbs

The **Repo surface** is the typed shape of `repo.on(Schema)`'s chain plus
Repo-level methods (`session`, `resolve`).

Each query-chain verb is a **gated verb** — its presence depends on the
Adapter's declarations:

| Chain verb | Gate |
|---|---|
| `repo.on(S).one().id(pk).find()` | `crud.findByPk` declared |
| `repo.on(S).one().create(d)` / `repo.on(S).all().create(d[])` | `crud.createMany` declared |
| `repo.on(S).one().id(pk).update(d)` | `crud.updateByPk` declared AND non-empty `updateOps` |
| `repo.on(S).one().id(pk).delete()` | `crud.deleteByPk` declared |
| `repo.on(S).raw(...args)` | `crud.raw` declared |
| `repo.on(S).one().where(q).find()` / `.all().where(q).find()` | `queryable.findMany` declared |
| `repo.on(S).one().where(q).update(d)` / `.all().where(q).update(d)` | `queryable.updateMany` declared AND non-empty `updateOps` |
| `repo.on(S).one().where(q).delete()` / `.all().where(q).delete()` | `queryable.deleteMany` declared |
| `repo.on(S).one().where(q).upsert(d)` | `queryable.upsertOne` declared |
| `repo.on(S).aggregate().<aggs>.<groupBy?>.<where?>.<having?>.run()` | `queryable.aggregate` declared AND non-empty `aggregateOps` |
| `repo.session(fn)` | `transactional.session` declared |

There is no truly "always-on" verb; every verb is gated by something. Verbs
whose gates aren't satisfied are narrowed-out (§3.3) — their type resolves to
`never` and calling them is a compile error.

### 5.2 Schema-per-call

**Schema-per-call** is the calling pattern: every per-schema operation enters
through `repo.on(Schema)`, instead of being baked into a per-schema Repo:

```ts
await repo.on(UserSchema).one().id('u1').find()
await repo.on(UserSchema).one().where(q => q.eq(UserSchema.fields.email, 'a@b.com')).find()
await repo.on(UserSchema).one().create({ name: 'Alice', email: 'a@b.com' })
await repo.on(UserSchema).one().where(q).update({ name: 'Alicia' })
```

The schema passed to `repo.on(...)` is the **schema arg**. `repo.on(...)`
returns a `SchemaRef<S>` carrying the schema's type forward through the chain.

**Per-call type narrowing**: each terminal verb's return type narrows to
`SchemaOutput<S>` (or `SchemaOutput<S> | null`, `SchemaOutput<S>[]`) based on
the schema arg captured at `repo.on(Schema)`. The Repo is parameterised by
Adapter only (`Repo<A>`); per-call return types flow through the `S` generic
threaded through `SchemaRef<S>`.

### 5.3 SchemaCompatible

`SchemaCompatible<A, S>` is the TypeScript guard that wraps the schema arg at
`repo.on(Schema)`. It resolves to `S` if every field type in the schema is in
`A['supportedFieldTypes'][number]`, and to `never` otherwise.

```ts
on<S extends AnySchema>(schema: SchemaCompatible<A, S>): SchemaRef<S>
```

Pairing an Adapter with a schema using a field type the Adapter doesn't
declare produces a **schema-incompatibility error** — TS error 2345 at the
`repo.on(...)` call site, blocking the entire chain that follows.

### 5.4 PK-keyed chains vs filter-based chains

Query chains split into two families based on which intermediate verb is
chosen:

- **PK-keyed chains** start with `.one().id(pk)` — they identify a document
  directly by primary key. Backed by the adapter's PK-keyed CRUD methods
  (label `crud` — `findByPk`, `createMany`, `updateByPk`, `deleteByPk`,
  `raw`).
- **Filter-based chains** use `.one().where(q)` / `.all().where(q)` — they
  identify documents via a `FilterGroup` filter (§11). Backed by the
  adapter's filter-based methods (label `queryable` — `findMany`,
  `updateMany`, `deleteMany`, `upsertOne`).

The split mirrors the method-group split on the adapter. PK-keyed and
filter-based chains can be declared independently — an adapter can be PK-only
(no `queryable` methods declared) or query-only (only `queryable` methods).

### 5.5 The `raw` escape hatch

`repo.on(Schema).raw(...args)` is the **escape hatch** for adapter-specific
power. There is exactly one entry point — `raw` on the schema-bound chain;
there is no Repo-level `repo.raw(...)`.

The adapter declares `raw`'s arg-tuple and default result type via its
function signature; the framework infers both. The Repo's chain propagates
the inferred shape and exposes a per-call `<T>` override on the result type:

```ts
// Adapter-side: method signature declares args + result
class PostgresAdapter extends configurable(pgConnectionPipe, OrmAdapter) {
  readonly schemaConfigPipe = v.object({ table: v.string() })
  // ...
  async raw(schema, schemaCfg, command: string, params: unknown[]) {
    const r = await this.#client.query(command, params)
    return r.rows                                // adapter-default result: unknown[]
  }
}

// Call site: args spread, optional <T> override on result
const orgs = await pgRepo.on(OrgSchema).raw<Org[]>('SELECT * FROM orgs WHERE id = $1', ['o1'])
```

Different adapters declare different arg-tuples — Postgres has
`[command: string, params: unknown[]]`, Mongo has
`[pipeline: Record<string, unknown>[]]`, a hypothetical ping adapter has
`[]`. The framework reads the adapter's `raw` signature, drops the
framework-supplied `(schema, schemaCfg, ...)` prefix, and uses the rest as
the chain's call-site args.

All adapter-specific filter shapes, server-side joins, aggregates, and
out-of-scope features go through `raw`.

### 5.6 Session method

The **session method** is `repo.session(fn)`. It is the only transaction
surface in the package. Inside a **session**, every `repo.on(Schema)...` chain
routes through the same adapter and joins the active tx connection
automatically. The function passed to `session(fn)` is the **session callback**.

See §8 for the full session vocabulary.

### 5.7 Required-row contract (`.required()`)

The **required-row contract** is the user-opt-in tightening of §13 principle
#6 (*always-throw-never-silently-drop*) for `OneBuilder`'s nullable verbs. A
chain **marked required** via `.required()` promises that the eventual
`find()` / `update()` / `delete()` will produce a row; if none does, the
framework throws `OrmNotFoundError` instead of returning `null`.

```ts
const user = await repo.on(UserSchema).one().id('u-abc').required().find()
// user: User                            — non-null; throws if no row matched

await repo.on(UserSchema).one()
  .where(q => q.eq(UserSchema.fields.email, 'a@b.com'))
  .required('user must exist')
  .update({ name: 'Alice' })             // throws if no row matched
```

`.required(message?: string)` is a **once-per-chain** modifier on
`OneBuilder`, free-floating in position like `.where()` / `.select()` /
`.preload()`. It flips a typestate parameter `Req` on the builder so the
return types of `find` / `update` / `delete` narrow from `T | null` to `T`.
`create` and `upsert` ignore it (their return types are unconditionally
non-null; `.required()` before them is a runtime no-op — see the *required-row
no-op rule* below).

The optional `message` argument replaces the framework-generated default in
the thrown error's `message` field. The default is generated from `schema` +
`operation` + filter shape — single-`eq`-on-PK chains render as
`"users.findOne: no row matched id=u-abc"`, filter-based chains render the
filter tree.

The runtime null check fires inside the `OneBuilder` verb, **post-adapter**.
The executors (`runOneRead`, `runOneUpdate`, `runOneDelete`) keep their
`T | null` return signatures unchanged; the throw is a builder-level concern.

`OrmNotFoundError extends EquippedError` is the error class:

```ts
class OrmNotFoundError extends EquippedError {
  schema: string                                    // schema.name
  operation: 'findOne' | 'updateOne' | 'deleteOne'  // sibling-consistent with OrmValidationError (§7.5)
  where: FilterGroup                                // the live FilterGroup that produced no match
}
```

Three rules govern the contract:

- **Required-row throw rule.** When `.required()` is on the chain and the
  verb's adapter call produces no row, the framework throws
  `OrmNotFoundError` from the builder layer (not from the executor).
- **Required-row no-op rule.** `.required()` before `create` or `upsert` is a
  runtime no-op — those verbs already return non-null, so the typestate flip
  has no effect. Compiles, doesn't throw, doesn't error.
- **Required-row scope rule.** The `.required()` modifier exists on
  `OneBuilder` only. There is no `AllBuilder` counterpart; "throw on empty
  array" is not in the model.

**Default-on-miss rule.** Without `.required()`, the existing silent-drop on
`update` / `delete` for "no row matched" is preserved by design — the
required-row contract is purely additive opt-in. Changing the default
behaviour would be a separate, breaking change.

### 5.8 Aggregation surface

The **aggregation surface** is `repo.on(S).aggregate()` and its chain — a
sibling cardinality entry verb, peer of `.one()` and `.all()`, terminating
in `.run()`:

```ts
// Single-bucket aggregation (no groupBy → returns one object).
const totals = await repo.on(OrderSchema).aggregate()
  .count('orders')
  .sum(OrderSchema.fields.total, 'revenue')
  .where(q => q.eq(OrderSchema.fields.year, 2026))
  .run()
// totals: { orders: number, revenue: number }

// Grouped aggregation (groupBy → returns an array of group rows).
const byRegion = await repo.on(OrderSchema).aggregate()
  .count('orders')
  .sum(OrderSchema.fields.total, 'revenue')
  .groupBy(OrderSchema.fields.region, OrderSchema.fields.year)
  .where(q => q.gte(OrderSchema.fields.year, 2024))
  .having(q => q.gt('revenue', 1000))
  .run()
// byRegion: Array<{ orders: number, revenue: number, region: string, year: number }>
```

Vocabulary:

- An **aggregator step** is a `.count(alias)` / `.countDistinct(field, alias)`
  / `.sum(field, alias)` / `.avg(field, alias)` / `.min(field, alias)` /
  `.max(field, alias)` call on the `AggregateBuilder`. Each adds one
  output column to the result row.
- The **alias** is the string literal at the aggregator step's last argument
  position; it becomes the result row's key and is the §2.3 uniqueness-guard
  key — duplicates are a compile error at the offending call.
- A **group key** is a schema-`Field` ref passed to `.groupBy(...)`. Group
  keys flow into the result row alongside the aliases, with their declared
  schema field types preserved.
- The **pre-filter** is `.where(q)` — applied to schema rows before
  aggregation. Same `FilterFactory` and `FilterGroup` (§11) as the rest of
  the package.
- The **post-filter** is `.having(q)` — applied to aggregated rows after
  aggregation. Typed over `(Aliases ∪ GroupKeys)`, not over the schema —
  the `FilterGroup` runtime class is reused but parameterised over the
  alias-and-group-key map.

Five rules govern the surface:

- **Aggregation cardinality rule.** The result cardinality is determined by
  whether `.groupBy(...)` was called. The `AggregateBuilder` carries a
  `HasGroupBy extends boolean` typestate parameter; `.run()` narrows the
  return type to `R` when `HasGroupBy = false`, `R[]` when `HasGroupBy = true`.
  No-`groupBy` aggregations return a single object directly, never a
  one-element array.
- **Field-type-per-aggregator rule.** Each aggregator step's field-arg
  generic is constrained at the type level: `sum` and `avg` accept
  `Field<'number', ...>` only; `min` and `max` accept
  `Field<'number' | 'string' | 'date', ...>`; `countDistinct` accepts any
  `Field`; `count(alias)` takes no field arg. `groupBy` keys must be
  `Field<'string' | 'number' | 'boolean' | 'date', ...>` — `'object'`,
  `'array'`, `'null'` are rejected at the type level. Direct parallel to
  §10.3's update-op field-category constraints.
- **Pre/post-filter split rule.** `.where(q)` filters schema rows pre-
  aggregation and is typed over `SchemaFields<S>` — the standard
  `FilterFactory`. `.having(q)` filters aggregated rows post-aggregation
  and is typed over the alias-and-group-key map; aggregator aliases are
  typed by the aggregator's return type (count/countDistinct/sum/avg
  always `number`; min/max keep the source field's type), group-key
  aliases keep the schema-declared type. Both are once-per-step.
- **Terminal-aggregator-required rule.** `.run()` is gated on at least one
  aggregator step having been called — `.aggregate().run()` with zero
  aggregators is a compile error (the build-prerequisite mechanism of
  §2.6, applied to a query-chain terminal instead of `.build()`).
- **Always-array adapter rule.** The adapter's `aggregate(schema, schemaCfg, spec)`
  method always returns `Array<Record<string, unknown>>` — even for
  no-groupBy single-bucket aggregations (length-1 array). The cardinality
  narrowing to `R | R[]` happens **post-adapter**, in the `AggregateBuilder.run()`
  method, by reading the `HasGroupBy` typestate. Same architectural shape
  as the post-adapter throw under the required-row contract (§5.7) — the
  builder layer does the user-facing return-type adjustment, not the
  adapter.

The adapter contract:

```ts
type AggregateSpec = {
  where?: FilterGroup                                   // pre-filter, schema-typed
  aggregates: ReadonlyArray<{
    fn: 'count' | 'countDistinct' | 'sum' | 'avg' | 'min' | 'max'
    field?: string                                      // logical field name; absent for count
    alias: string                                       // output key
  }>
  groupBy: readonly string[]                            // logical field names
  having?: FilterGroup                                  // post-filter, alias-map-typed
}

aggregate?(
  schema: AnySchema,
  schemaCfg: SchemaConfig,
  spec: AggregateSpec,
): Promise<Array<Record<string, unknown>>>
```

Validation is single-shot at the Repo-entry boundary via
`assertNormalisedAggregate(schema, adapter, spec)`. Failures are collected
under `OrmValidationError` with `kind: 'aggregate'` (§7.5). Specific failure
flavours — alias collision with a group-key name, undeclared aggregator op,
field-type mismatch (defense-in-depth for the type-level constraints), having-
filter referencing an unknown alias — all collapse to the single `'aggregate'`
kind, with detail in the per-failure carrier.

**Out-of-aggregation-surface escapes.** Window functions, expression-based
group keys (`GROUP BY lower(name)`), expression-based aggregator inputs
(`SUM(price * qty)`), arbitrary projection of computed columns, joined
aggregations, statistical aggregates, and `FILTER (WHERE ...)` per-aggregate
clauses are all out of the canonical surface. They go through the adapter's
`raw` method (§5.5).

---

## 6. Configuration resolution

The Repo holds two pieces of config-machinery: a **base resolver** that maps
a schema to a config (build-time, required), and a **runtime override stack**
that lets callers temporarily transform the base config (call-time, optional).

### 6.1 Two-tier config and the base resolver

Adapter configuration splits into two tiers:

- **Connection config** — connection-level (URI, credentials, pool options).
  Lives on the adapter instance (`this.config`), validated **once** at
  `MyAdapter.create(...)` against the `connectionPipe` declared in
  `configurable(connectionPipe, OrmAdapter)` (§1.3). Not produced by the
  resolver; not transformed per query.
- **Schema config** — per-schema (table name, collection name, mapper
  options). Produced **per query** by the Repo's base resolver (and possibly
  transformed by the runtime override stack, §6.2). Validated against
  `adapter.schemaConfigPipe` at the Repo→Adapter boundary every query (§6.3).

The **base resolver** is the function passed to `Repo.from(adapter).resolve(...)`
at build time. It produces a **base schema config** per schema. The
resolver's return type is constrained to `PipeInput<typeof adapter.schemaConfigPipe>`
— the framework enforces `(schema: AnySchema) => SchemaConfigInput`.

```ts
const adapter = PostgresAdapter.create({ host, port, user, password })
//      ^^^^^^^ connection config validated here, exposed as adapter.config

const repo = Repo.from(adapter)
  .resolve((schema) => ({ table: schema.name }))   // schema-config; typed by adapter.schemaConfigPipe
  .build()
```

The base resolver is the only thing that *produces* a schema config from a
schema. Without `.resolve(...)`, `.build()` is unavailable (§2.6).

### 6.2 Runtime override: `repo.resolve(transform, fn)`

A `ConfigTransform<C>` is a function `(cfg: C, schema: AnySchema) => C` that
transforms a base config per query.

`repo.resolve(transform, fn)` is the **runtime override mechanism**. It pushes
`transform` onto an internal stack for the duration of `fn`; every query made
inside `fn` (including async children and nested `repo.resolve` calls) picks
up the transform automatically. The stack is popped on `fn`'s settlement
(success or throw).

```ts
await repo.resolve(
  (cfg, schema) => ({ ...cfg, table: `t_${tenantId}_${cfg.table}` }),
  async () => {
    await repo.on(UserSchema).all().find()       // sees transformed config
  },
)
```

The stack is backed by `AsyncLocalStorage` so concurrent async chains see
their own scopes — `Promise.all([repo.resolve(t1, ...), repo.resolve(t2, ...)])`
works correctly without leakage.

`repo.resolve(transform, fn)` is the **only** runtime config-transform
mechanism. There is no separate `ContextSource` builder step; users wanting
DI- or middleware-driven scope-entry call `repo.resolve(transform, fn)` from
their own scope-entry layer (§6.5).

### 6.3 Config resolution pipeline

The **config resolution pipeline** is the per-query process that produces the
**effective schema config** — the schema-level config actually handed to the
adapter method:

1. **Base resolve.** `.resolve(...)` runs against the schema → base schema config.
2. **Stack apply.** Every transform currently active on the runtime stack
   (pushed via `repo.resolve(transform, fn)`) is applied in push order on top
   of the base.
3. **Pipe validate.** The composed result is validated against
   `adapter.schemaConfigPipe` (§3.2). Failure throws an `OrmValidationError`
   from the Repo dispatch layer — pointing at the resolver/transform stack,
   not the adapter internals. Validation runs at the Repo→Adapter boundary,
   consistent with the package's "every layer boundary gets a pipe" rule
   (§7.1).

The **per-query resolution rule**: this pipeline runs for every query —
top-level chains, preload sub-queries (§9.8), and queries inside a session.
There is no session-level or Repo-level schema-config caching that bypasses
the pipeline.

Connection config (`adapter.config`) is **not** part of this pipeline. It is
validated once at `Adapter.create(...)` and stays put for the lifetime of the
adapter instance.

### 6.4 Library-owned ALS scope (config only)

The library uses `AsyncLocalStorage` internally to back the
`repo.resolve(transform, fn)` stack. This is **scoped to config resolution
only** — adapters still own their own tx-context propagation (§8.2,
principle #13.8 in the cross-cutting principles table), and the framework
does not enter or run ALS scopes for any purpose other than `repo.resolve`.

Adapters are free to use any mechanism for tx-context propagation: ALS on
Node/Bun/Deno/Workers, runtime equivalents on edge platforms, or explicit
threading. The framework's use of ALS for `repo.resolve` does not constrain
adapter implementations.

### 6.5 Tenant scoping

**Tenant scoping** is the canonical use case for `repo.resolve`. Pattern:
middleware wraps the request handler in `repo.resolve(transform, fn)` so every
chain inside the handler picks up the transform automatically.

```ts
const repo = Repo.from(PgAdapter)
  .resolve((s) => ({ table: s.name }))
  .build()

// Middleware: wrap each request in repo.resolve
app.use(async (req, _res, next) => {
  const tenantId = req.header('x-tenant')!
  await repo.resolve(
    (cfg) => ({ ...cfg, table: `t_${tenantId}_${cfg.table}` }),
    async () => next(),
  )
})

// Handler — uses the module-imported `repo` directly
async function getUser(req, res) {
  const u = await repo.on(UserSchema).one().id(req.params.id).find()
  // tenant transform applied automatically via the active repo.resolve scope
}
```

The **untenanted-query footgun**: if the user forgets to wrap a route in
`repo.resolve(...)`, queries silently hit the base config (unprefixed table).
Two documented mitigations:

- **Fail-loud pattern.** Define a base resolver that throws when no scope is
  active (track a sentinel in the transform stack and check for it at the
  base).
- **Sentinel scope pattern.** Wrap legitimate non-tenant code (admin routes,
  migrations) in `repo.resolve(noOpTransform, fn)` so missing-tenant is
  impossible by construction.

The library doesn't enforce either; admin and migration routes have
legitimate non-tenant uses.

### 6.6 Cross-schema sessions and scope-session composition

**Scope-session composition**: when a tenant `repo.resolve(...)` scope wraps
a `repo.session(...)`, every query inside picks up both the tenant transform
(framework-owned via the ALS-backed stack) and the tx connection
(adapter-internal via tx-context propagation, see §8). The two layers
compose without interaction — the tenant transform runs in the config
resolution pipeline; the tx connection routing happens inside the adapter.

### 6.7 What's not in the model

- **Single-Repo rule.** A Repo is built once around a single adapter with a
  single base resolver. Per-tenant or per-context derivation is achieved via
  `repo.resolve(transform, fn)`, not by deriving sub-Repos. There is no
  `repo.withConfig(transform)` chain that returns a new Repo.
- **No-registry rule.** There is no global registry mapping schemas to Repos.
  A Repo handles all schemas it can compatibility-narrow against.
- **Adapter-only-typed-Repo rule.** A Repo is parameterised by Adapter only
  (`Repo<A>`), not `Repo<S, A>`. Per-call return types narrow via the schema
  arg's `S` generic threaded through `SchemaRef<S>`.

---

## 7. Validation flow

Validation runs once, in the package, at the Repo-entry boundary. Adapters
never re-validate.

### 7.1 Repo-entry boundary and the validate-once rule

The **Repo-entry boundary** is the location where validation runs: at the
entry of every Repo method, before any adapter call. The **validate-once rule**:
validation runs exactly once, at the Repo-entry boundary; the adapter receives
**validated input** and is not expected to re-validate.

### 7.2 Create, update, and filter validation

Three families of validation, each named by its function:

- **`validateCreate(schema, document)`** runs on `createOne` / `createMany`
  inputs. Validates the full document against schema pipes; injects `onCreate`
  defaults for missing fields. Rule: **create-validates-full-document**.
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
accumulates them across the input (multiple rows in `createMany`, multiple ops
in update calls) and throws a single error at the end — never fail-fast on the
first.

`OrmValidationError extends EquippedError` is the error class for all
Repo-entry boundary throws. It has a `kind` discriminant for programmatic
classification:

```ts
class OrmValidationError extends EquippedError {
  kind: 'validation' | 'conflicting-ops' | 'empty-group' | 'undeclared-op' | 'upsert-filter-incompatible' | 'aggregate'
  schema: string
  operation: 'createOne' | 'createMany' | 'updateOne' | 'updateMany' | 'updateByPk' | 'upsertOne' | 'aggregate'
  failures: Array<{
    opIndex?: number
    rowIndex?: number
    field?: string
    alias?: string                                      // aggregate-only: the offending alias / group-key name
    cause: PipeError
  }>
}
```

Each entry in `failures` is a **failure entry**. The `kind` field is the
**error kind**. Users catch `OrmValidationError` for boundary-specific
handling, or `EquippedError` for any package-thrown error.

`OrmValidationError` is the error class for **Repo-entry boundary** throws
(input-shape failures caught before any adapter call). For **post-adapter**
"no row matched" throws under the required-row contract, see
`OrmNotFoundError` in §5.7 — a sibling `EquippedError` subclass with its own
carrier shape. Both classes live under `src/orm/errors/`.

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

The **create-validation pipeline** runs `validateCreate` per document, collects
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
framework. Tx semantics genuinely differ per adapter (PG savepoints, Mongo
subtransactions, Firebase no-ops, edge runtimes' per-request tx model); the
framework has no business dictating the mechanism.

A **tx-aware adapter method** is one that, on entry, checks for an active
session context and routes through the tx connection if one exists; otherwise
it grabs from the pool. **Every adapter method must be tx-aware.** The adapter
is free to use Node ALS, runtime equivalents on edge platforms (Workers'
tx-per-request, Deno's runtime, etc.), or any other mechanism.

(The framework itself uses ALS internally for `repo.resolve(...)` config
scoping, §6.4 — but that scope is config-only and does not interact with
adapter tx-context propagation.)

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

The **source schema** is the schema passed first to `Relations.from(SourceSchema)`.
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

The **Field-only-FK rule**: FK refs in `Relations.from(...)` must be
`Field<T, N, S>` refs from the relevant schema's `fields` accessor — not raw
string keys. A string FK pointing at a number PK is now a compile error; the
**FK-PK type-match guarantee** flows from this rule.

### 9.3 Source-positional construction

`Relations.from(source)` takes the source schema as its positional first arg.
The source variable is a const in the outer lexical scope, so FK refs that
point at the source (`belongsTo`'s FK) reference it directly:

```ts
const UserSchema = Schema.from('users')
  .pk('id', v.string())
  .field('orgId', v.string())
  .build()

const UserRels = Relations.from(UserSchema)
  .hasMany('posts', PostSchema.fields.userId)
  .belongsTo('org', UserSchema.fields.orgId, OrgSchema)
  .build()
```

There is no "source binding" alias — the source is the same variable users
already declared, so reference it by name.

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
const UserRels = Relations.from(UserSchema)
  .belongsTo('mgr', UserSchema.fields.managerId, UserSchema)
  .build()
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
const PostTagSchema = Schema.from('post_tags')
  .pk('id', v.string(), () => 'pt-id')
  .field('postId', v.string())
  .field('tagId', v.string())
  .build()

const PostRels = Relations.from(PostSchema)
  .hasMany('postTags', PostTagSchema.fields.postId)
  .build()

const PostTagRels = Relations.from(PostTagSchema)
  .belongsTo('post', PostTagSchema.fields.postId, PostSchema)
  .belongsTo('tag', PostTagSchema.fields.tagId, TagSchema)
  .build()
```

Users access tags from a post via a **two-step preload** (`post.postTags[].tag`).
No sugar exists because join schemas frequently carry their own data
(`created_at`, role on a `user_roles` join). Sugar that hides the join schema
obscures this; the explicit form keeps the join as a first-class entity.

### 9.8 Preloads

**Preload** is the framework-side mechanism for loading related documents:
`repo.on(UserSchema).all().preload([UserRels.posts, ...]).find()`.

**Package-side preload.** Preloads run package-side via `findMany` against any
queryable adapter. Cycle detection, max depth, and N+1 dispatch all live in the
package. Server-side joins (PG `JOIN`, Mongo `$lookup`) are out of scope; users
go through `raw`.

Vocabulary:

- **Cycle detection** stops infinite preloading via cyclic relations.
- **Max preload depth** is the per-request limit on preload chain depth.
- **Batched dispatch** is the framework batching N child queries into one
  `findMany(schema, q.in(fk, parentIds))` call (avoids N+1).
- **Preload context-flow rule.** Preloads honour `repo.resolve(...)` transforms
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
includes the kind, and to `never` otherwise — per-op gating (§3.4).

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
mechanic as narrowed-out methods (§3.3), at the helper layer.

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
`upsertOne`) are gated on method presence on the adapter class, not on
`updateOps` membership.

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
  sub-tree structure, not field-ops; the per-op gating rule (§3.4) applies to
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
locks this — consistent with the no-emulation rule (§3.4) and the closed-set
rule (§4.4).

### 11.8 Filter-tree clone

`FilterGroup.clone()` deep-clones the tree, including `structuredClone` of
values, so callers can safely mutate the result.

---

## 12. Upsert

`upsert` is a filter-based chain verb gated by `queryable.upsertOne` declared
on the adapter, reached via the schema-bound chain.

### 12.1 API shape

```ts
await repo.on(UserSchema)
  .one()
  .where(q => q.eq(UserSchema.fields.email, 'a@b.com'))
  .upsert({
    create: { name: 'Alice', email: 'a@b.com' },
    ops: [set({ lastSeen: Date.now() }), inc(UserSchema.fields.loginCount, 1)],
  })
```

Three argument roles:

- The **filter callback** (the `q => ...` arg passed to `.where(...)`). See §11.
- The **create payload** (`{ name, email }`). The **full-create-payload rule**
  locks this as `SchemaInput<S>` (full document, same as `create`), not
  `Partial`.
- The **op list** (`set(...)`, `inc(...)`). See §10.

### 12.2 Gate rule

**Upsert gate rule.** `upsertOne` exists when `upsertOne` is declared as a
method on the adapter class. Missing → narrowed-out. Symmetric with every
other filter-based Repo method (§5.1) — gate is method presence, no separate
capability flag.

`upsertOne` is meaningful only when `queryableOps` is non-empty, and the
filter chain it consumes is gated on those ops; with `queryableOps = []` the
filter argument is unreachable and `upsertOne` is effectively narrowed-out at
the consumer (self-policing — see §3.3). It accepts the adapter's declared
`updateOps` for its op-list arg. Both flow through the existing filter and
update machinery; no upsert-specific declaration exists.

The **query-only-upsert rule**: there is no `upsertByPk` variant. Real-world
upserts identify by natural key (email, slug, FK), not PK. PK-keyed upsert is
expressible as `q.eq(schema.pkField, pk)` if needed.

The **upsert-in-queryable rule**: `upsertOne` is grouped with the filter-
based methods (label `queryable`), not with PK-keyed CRUD (label `crud`).
Important for adapter authors — its filter argument flows through the same
machinery as `findMany` / `updateMany` / `deleteMany`.

### 12.3 Dual-path semantics

`upsertOne` has two execution paths depending on whether the row exists:

- **Create-then-ops semantics.** Row missing: validate the create payload via
  `createOne` rules (`onCreate` defaults injected), create it, then apply
  atomic ops on top. SetOp values override created fields; atomic ops apply
  to the created values (e.g. `inc(views, 1)` on create with `views: 0` →
  `views: 1`).
- **Update-only-on-exists semantics.** Row exists: ignore the create payload
  entirely; apply ops to the existing row. The Q7.α auto-bump rule applies on
  this path — fields with `onUpdate` not touched by user ops get implicit
  `set` ops.

The pair together is **upsert dual-path semantics**.

The **upsert auto-bump rule**: auto-bump (§7.3) applies on the update path of
upsert. Fields with `onUpdate` not in the touched-fields set get implicit
`set({ <field>: <onUpdate()> })` ops.

The **upsert create-vs-op conflict rule**: an extension of the field-conflict
rejection rule (§7.4). If the create payload sets `views: 0` AND an op
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
- **Empty-ops-allowed-on-upsert rule.** `.upsert({ create })` with no ops is
  allowed — it's "upsert this; if it exists do nothing." This is distinct
  from the non-empty op-list rule (§10.5) for `.update(...)`, where the ops
  are the only thing the call does.

---

## 13. Cross-cutting principles

A **principle** is a rule that constrains code in three or more layer-sections
of this document, or is a fundamental non-goal. Layer-local rules stay in
their layer-section. The **spans-three-sections rule** is the admission
criterion: a rule earns a place here if it crosses three or more sections.

| # | Principle | Statement |
|---|---|---|
| 1 | **Builder-chain rule** | Static-factory builder chains (`X.from(args).step()...build()`) are the canonical shape for all artifact construction; direct calls for invocation/operations. (§2.2) |
| 2 | **No-emulation rule** | The framework never emulates a missing op or method client-side. Adapter-specific power lives in the adapter's `raw` method only. (§3.4) |
| 3 | **Closed-set rule** | Adapters subset the canonical sets (filter ops, update ops, field types, relation kinds); they cannot extend them. Extension requires a package version bump. (§4.4) |
| 4 | **Type-system-is-the-contract rule** | Capability mismatches are compile errors wherever feasible, not runtime throws. The TypeScript surface is the load-bearing contract. |
| 5 | **Validate-once rule** | Validation runs exactly once, at the Repo-entry boundary; adapters receive validated input and never re-validate. (§7.1) |
| 6 | **Always-throw-never-silently-drop rule** | Empty filter groups, missing fields, unknown ops, conflicting ops fail loudly. No silent short-circuits, no "match-all" / "match-none" fallbacks at boundaries. |
| 7 | **No-runtime-value-coercion rule** | Filter values are a TS-only contract. The framework does not run pipes on filter values. (§11.6 invariant C) |
| 8 | **Adapter-owned tx propagation rule** | Tx-context propagation lives entirely inside the adapter, not in the framework. (§8.2) |
| 9 | **Schema relations-agnosticism rule** | Schemas contain no relational information. All relational concerns live in the Relations artifact. (§9.6) |
| 10 | **Single-Repo rule** | A Repo handles all schemas it can compatibility-narrow against. No registry, no per-Repo derivation, no per-schema typed Repos. (§6.7) |

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
