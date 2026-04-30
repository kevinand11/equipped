# ORM Redesign — Design Tree Notes

Context: redesign of `src/orm` in `equipped`, drawing inspiration from JS Drizzle and Elixir Ecto. Captured from a `/grill-me` design conversation. Use this doc to resume the design with another agent.

---

## Goal

Build an ORM in `equipped` that:

- Supports SQL **and** NoSQL (Mongo, Firebase, …) under one API.
- Ships **no** database-specific implementations from the package itself; users bring their own adapters.
- Lets a third party write an adapter for *any* database-like store (including a file-based DB) without forking the package.
- Provides typed, capability-aware Repo APIs so the user's call surface narrows to what their adapter actually supports.
- Draws on Drizzle (typed builder, narrow surface, no runtime magic) and Ecto (pluggable adapter behaviours, multi-store reach).

---

## Decisions LOCKED (in order resolved)

### Q1 — target databases
- **Universal adapter**: SQL + Mongo + Firebase + arbitrary user-written adapters (file-DB, etc).
- Implication: the API contract is the load-bearing piece. Mongo + Firebase are not afterthoughts.

### Q2 — capability mismatches across adapters
- Approach: **portable core only** (extensions dropped — see scope note below), backed by **type-level capability gating** (option **C**).
- Adapters declare which optional behaviours they implement; the Repo's typed surface narrows to those.
- Adapter-specific power (e.g. PG full-text search, Firebase realtime) is reachable only via `raw` for now. **Extensions deferred / out of scope.**

### Q3 — adapter contract shape
- **Layered behaviours (C)** for implementation modularity. Adapter-contributed typed extensions deferred (out of scope for now).
- Required: `AdapterStorage` (a small always-on contract).
- Optional: separate behaviour interfaces for each capability. Adapters opt in to those they support.
- ~~Adapters contribute their own typed `extensions` namespace that the Repo merges into its surface.~~ **Dropped — adapter-specific power goes via `raw` only.**

### Q3.x — adapter authoring style: factory > class
- **Factory variant chosen.** `defineAdapter({ queryableOps: [...], updateOps: [...], storage: {...}, queryable: {...}, ... })`.
- Reason: the factory's argument type is computed from the declared op-list literals, so declaring an op without supplying the corresponding behaviour bag is a TypeScript error — class form relies on `implements` clauses as a manual convention.
- **No `as const` needed at call sites.** Factory uses TS 5.0+ `const` type parameter modifier (`<const Ops extends readonly QueryableOp[]>`). Callers write `queryableOps: ['eq','ne']` directly; TS infers `readonly ['eq','ne']` and preserves the literal types needed for per-op narrowing. (Package is on TS 5.9.)
- **Durable preference**: factory-style preferred over class-style for future API decisions in this package. Present both when relevant, but lead with and emphasise factory. (Saved to memory.)

### Q4 — capability layout (FINAL — reflects all subsequent revisions)

**No `capabilities` array.** Capabilities are **inferred structurally** from what the adapter declares. Each capability has either a literal op list (`queryableOps`, `updateOps`) or a behavior bag (`transactional`); presence of either is the declaration.

**No required bags.** Every bag is optional; the framework calls into them only if present. Reason: many modern adapter targets (Firestore, DynamoDB, edge serverless drivers, in-memory mocks, REST-API adapters) have no meaningful connect/disconnect — forcing no-op stubs is silent ceremony.

| Capability | Inferred from | Methods on Repo |
|---|---|---|
| Lifecycle | optional `lifecycle` bag | (internal — not on Repo surface; framework calls if present) |
| CRUD (PK-keyed + raw) | optional `crud` bag — each method independently optional | `findByPk`, `insertOne/Many`, `updateByPk`, `deleteByPk`, `raw` |
| Queryable (filter-based) | optional `queryable` bag (requires non-empty `queryableOps`); methods independently optional | `findOne/Many`, `updateOne/Many`, `deleteOne/Many` |
| Updatable (cross-cuts crud + queryable) | non-empty `updateOps` | governs ops accepted by `updateByPk`, `updateOne/Many` |
| Transactional | optional `transactional: { session }` bag | `session(fn)` |

`transactional` is the only capability without an op list (it's a single-feature toggle). Asymmetry accepted — inventing a singleton list `transactionalOps: ['session']` would be ceremony.

#### Op lists (closed canonical sets, adapter subsets a portion)

```ts
queryableOps:  'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'nin' | 'like' | 'exists' | 'contains' | 'ncontains'
updateOps:     'set' | 'inc' | 'mul' | 'min' | 'max' | 'unset' | 'push' | 'pull' | 'patch'
```

- **`set` is a declarable op, not always-on.** An adapter that doesn't list `'set'` in `updateOps` cannot do set-shape writes through the typed API. (In practice every realistic adapter will list it; framework no longer assumes.)
- **`updateOps` covers all update paths**: `repo.updateByPk(pk, ...ops)`, `repo.updateOne(filter, ...ops)`, `repo.updateMany(filter, ...ops)`. Same gating across the three.
- **Pipe validation is per-op, not per-capability.** `set` operands validated against schema pipes when declared; other op operands not validated (resulting value depends on existing row state).

#### Sub-decisions inside Q4

- **4c — Joins/preloads**: dropped `joining` capability for now. **Preloads run package-side via `findMany`** for any queryable adapter. Cycle detection + max-depth + N+1 dispatch all live in the package. No `findManyJoined` exists. Server-side joins (PG, Mongo `$lookup`) reachable only via `raw`.
- **4e — Aggregates** (`count`/`sum`/`avg`/etc.): **out of scope.** Users go through `raw`.
- **4f — Streaming / change-feeds**: **out of scope.** Users go through `raw`.
- **4g — Migrations / DDL**: **out of scope** (matches today's README).
- **Per-op declaration is honest partial support.** Firebase honestly declares `queryableOps: ['eq','ne','gt','gte','lt','lte','in','nin']` (no `like`/`contains` server-side) and `updateOps: ['set']` (atomic `FieldValue.increment` etc. via `raw` for now). All-or-none was previously locked then overturned.
- **`and` / `or` are always available** on any queryable adapter — structural combinators, not field-ops. The per-op list governs only the field-op set.
- **TS-only narrowing (runtime methods stay).** All canonical methods exist on `QueryGroup` at runtime; TS types unsupported ones to `never` based on the adapter's declared op lists. Boundary check from Q5.2 rejects undeclared ops at runtime if TS was bypassed.
- **Omission = empty list.** `queryableOps` not present is equivalent to `queryableOps: [] as const`. Factory defaults missing fields. Authors who want explicit "deliberately none" can still write `[] as const`.
- **No silent emulation, ever**. If an op isn't in the adapter's list, the corresponding method is `never` on the Repo (compile error). No fallback re-implementations.

### Q5.1 — update API shape (operation-list) [REVISED post-Q4 collapse]

- **Single unified op list, no `set` vs `atomic` capability split.** All update ops live in adapter-level `updateOps` literal list (see Q4). `atomicMutations` capability dropped.
- **API shape**: `repo.updateOne(filter, ...ops)` and `repo.updateMany(filter, ...ops)` (Q5.4 = two methods); `repo.updateByPk(pk, ...ops)` for PK-keyed update via storage. All take the same op list.
- **`set` is one declarable op among many** — not always-on. Adapter must list `'set'` in `updateOps` to enable set-shape writes through the typed API.
  - `set({...})` — values validated against the schema's pipes (existing valleyed integration). Per-op rule, encoded in package boundary.
  - `inc / mul / min / max / unset / push / pull / patch` — operands not validated (resulting value depends on existing row state).
  - All ops still type-check at compile time (e.g. `inc` only accepts `NumericFieldOf<S>`, `push` only `ArrayFieldOf<S>`).
- **Capability gating** (type-level, per-op against `updateOps`):
  ```ts
  type UpdateOp<S, A> =
    | ('set'   extends A['updateOps'][number] ? SetOp<S>   : never)
    | ('inc'   extends A['updateOps'][number] ? IncOp<S>   : never)
    | ('mul'   extends A['updateOps'][number] ? MulOp<S>   : never)
    | ('min'   extends A['updateOps'][number] ? MinOp<S>   : never)
    | ('max'   extends A['updateOps'][number] ? MaxOp<S>   : never)
    | ('unset' extends A['updateOps'][number] ? UnsetOp<S> : never)
    | ('push'  extends A['updateOps'][number] ? PushOp<S>  : never)
    | ('pull'  extends A['updateOps'][number] ? PullOp<S>  : never)
    | ('patch' extends A['updateOps'][number] ? PatchOp<S> : never)
  ```
  Op helpers resolve to `never` per-op based on `A['updateOps']`. Calling an undeclared op is a compile error.
- **Helper functions** preferred over object-literal sentinels for typing. Optionally also expose under an `ops.*` namespace to avoid collision with native `Set`.
- **Operator-set extensibility**: closed canonical set (Q5.3). Adapters subset; cannot register new ops. Custom ops go via `raw` only.

#### Tentative sub-decisions inside Q5.1 (lightly recommended, not yet user-locked)

- **Repeated-field handling**: if user supplies conflicting ops on the same field (e.g. `set({views: 0})` + `inc(views, 1)`), package should error rather than apply in order. Recommended, awaiting confirmation.
- **Empty op list**: `repo.update(filter)` with no ops should be rejected (require ≥1 op via signature).

---

## Decisions UNRESOLVED — pick up here

### Q5.2 — input shape adapters receive (LOCKED)

**Decision: (ii) same `QueryGroup` class flows to adapter; package runs `assertNormalised(schema, q)` at the boundary.** No new type, no brand. The adapter signature stays `findMany(schema, q: QueryGroup, ...)`.

**Normalisation contract (what the package guarantees about `q` before handing to the adapter):**

- **A ✅ Field existence.** Every `Field<T>`-resolved name must exist in the schema. Unknown names → reject at boundary.
- **B ✅ Op closure.** Every op is in the canonical set (free — `WhereOp` is an enum).
- **C ❌ No runtime value coercion.** Field value types are a **TypeScript-only contract**. `Field<T>` carries `T`; passing a wrong-typed value compile-errors. The package does **not** run schema pipes on filter values. If the user bypasses TS (`as any`, raw string field), the wrong-typed value reaches the adapter as-is — adapter behaviour from there is adapter-defined. Asymmetry with `set({...})` (which *is* pipe-validated) is intentional: insert-shaped writes own the resulting row; filter values match against existing storage which the schema doesn't own.
- **D ❌ No tree flattening.** Adapter receives the tree shape verbatim. Assumption: user passes an optimised query.
- **E ✅ Empty `and([])` / `or([])` throws at builder time.** The throw happens inside `QueryGroup.and` / `QueryGroup.or` the moment the user calls it — not at the boundary. Stack trace points at the offending call. `QueryGroup` is well-formed by construction; the boundary doesn't need to recheck. Honours "always throw, never silently drop."
- **F ✅ Logical schema names at the boundary.** `Where.field` is the schema-declared field name (`field.name` if a `Field<T>` ref was passed; raw string verbatim otherwise per C-fallback). Adapter is responsible for **physical mapping** (`id`→`_id`, snake_case, column aliases) — that stays in the adapter.

**Raw-string field overload (C1):** `QueryGroup.eq('age', '18')` etc. is allowed; `T` collapses to `unknown`/`any`. User-beware escape hatch for dynamic queries; no new API needed.

### Q5.3 — operator-set extensibility (LOCKED)

**Decision: closed canonical set, per-adapter subsetting.** Implicitly answered by the Q4 redesign — per-op declaration is fundamentally a subsetting model. Adapters pick from the closed canonical set; they cannot register new ops. Custom adapter-specific filter shapes (PG `@@` FTS, Mongo `$geoWithin`, Firebase `array-contains-any`) go via `raw` only (extensions dropped). Adding a new canonical op requires a package version bump.

The all-or-none "honesty" worry that motivated open-as-a-relief-valve is now solved by per-op declaration: Firebase honestly declares `['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'nin']` and TS narrows `like` / `contains` away.

### Q5.4 — one update method or two (LOCKED)

**Decision: two methods.** `repo.updateOne(filter, ...ops): T | null` + `repo.updateMany(filter, ...ops): T[]`. Symmetric with the locked `findOne` / `findMany` and `deleteOne` / `deleteMany` pairs. Adapter-level `LIMIT 1` / native `updateOne` is faster than scanning all matches when the user only wants one. `updateOne` with a non-unique filter selects "first match wins" (matches today's Mongo / PG-with-LIMIT-1 semantics).

### Q5.5 — storage CRUD-by-PK quartet + lifecycle split (LOCKED — emerged during Q5.4 grill)

**Decisions:**
1. CRUD-by-PK quartet completed: `findByPk` (renamed from `getByPk` for verb-symmetry), `insertMany`, `updateByPk` (NEW), `deleteByPk`. Plus `raw`.
2. **`connect` / `disconnect` extracted to a separate `lifecycle` bag** — different shape (no schema, no cfg payload), different responsibility.
3. **All bags optional.** Including `lifecycle` — many adapter targets (Firestore, DynamoDB, edge serverless drivers, in-memory, REST APIs) have no meaningful connect/disconnect, and forcing no-op stubs is silent ceremony. Within bags, methods are also independently optional. Repo surface narrows per-method.

```
AdapterLifecycle?:          // optional
  connect()
  disconnect()

AdapterCrud?:               // optional, methods optional within
  findByPk?(schema, pk, cfg)
  insertMany?(schema, rows, cfg)
  updateByPk?(schema, pk, ops, cfg)
  deleteByPk?(schema, pks, cfg)
  raw?(...)
```

Reason: Firebase has native PK update (`updateDoc(docRef, data)`) but no native query-based update. Putting `updateByPk` in always-on storage (alongside the already-mutating `insertMany` / `deleteByPk`) lets Firebase honestly declare a useful write path without claiming `queryable`. Mongo / PG / file-DB all trivially support PK update. `updateByPk` accepts the full `updateOps`-gated op list — same signature pattern as `updateOne` / `updateMany`.

### Q5.x — Q5.1 sub-decisions (LOCKED)

- **Reject conflicting ops on the same field at the package layer.** `repo.updateMany(filter, set({views: 0}), inc(views, 1))` throws at the boundary with "conflicting ops on field views". Walk the op list collecting `{op.kind, op.field}` pairs; any field touched twice is a conflict. Includes cross-kind conflicts (e.g. `unset(x) + push(x)`). Reason: order-dependent semantics across adapters (Mongo / PG / Firebase apply set+inc in different orders) is exactly the silent inconsistency we banned. Conflicts are almost always bugs; loud failure beats a wrong number in prod. Users who genuinely want sequential semantics use two calls inside `session()`.
- **Require ≥1 op in `update*` call signatures (compile error).** Signature: `update*(filter, op0: UpdateOp<S, A>, ...rest: UpdateOp<S, A>[])`. An update with no ops is meaningless — TS catches it at the call site. Same family as the builder-time empty `and([])` / `or([])` rejection.

### Branches NOT YET DRILLED (planned next, in this order)

1. **`AdapterStorage` exact required surface** — RESOLVED for find/update/delete by PK (see Q5.5). Storage is `connect`, `disconnect`, `findByPk`, `insertMany`, `updateByPk`, `deleteByPk`, `raw`. Still open: where does `upsert` end up given Q5.1's op-list update model?
2. **Schema portability for adapter-specific config** — where does PG `varchar(255)` / Mongo index hint / Firebase collection path live? On the schema, on the adapter's `use(schema, config)`, or on a `schema.resolve(adapter, {...})` map (current pattern)?
3. **Validation flow** — Repo runs schema pipes for `insert`, `set` op values, and filter values. Adapters never re-validate. Need to lock the exact boundary and confirm Repo-side error shape.
4. **Transactions / `session` shape** — Ecto.Multi-style composability vs simple callback. How does `session` interact with the Repo (does each call inside the callback re-bind to a transactional connection)?
5. **Relations declaration shape** — Drizzle declares relations separately; Ecto declares them inline with the schema. Today's code has `hasOne / hasMany / belongsTo`. Confirm the shape and decide on many-to-many ergonomics (currently explicit join schemas).
6. **Repo construction surface** — `Repo.from(schema, adapter, config)` vs `defineRepo(...)` factory. (Given the factory preference, factory likely wins.)
7. **Naming drift** — README says `notExists` / `notIn`, code says `nexists` / `nin`; README says `QueryGroup.raw(...)` exists, code lacks it. Reconcile.

---

## Architectural reference (current locked state)

### Capabilities (inferred structurally — no `capabilities` array)

| Capability | Inferred from | Op list |
|---|---|---|
| Lifecycle | optional `lifecycle` bag | — |
| CRUD (PK-keyed + raw) | optional `crud` bag — methods independently optional | — |
| Queryable (filter-based) | optional `queryable` bag (requires non-empty `queryableOps`) | `'eq'\|'ne'\|'gt'\|'gte'\|'lt'\|'lte'\|'in'\|'nin'\|'like'\|'exists'\|'contains'\|'ncontains'` |
| Updatable | non-empty `updateOps` (governs ops in `updateByPk` / `updateMany`) | `'set'\|'inc'\|'mul'\|'min'\|'max'\|'unset'\|'push'\|'pull'\|'patch'` |
| Transactional | optional `transactional` bag | — |

All bags optional. No required adapter fields except `config` (type marker).

### Behaviour interfaces

```ts
interface AdapterLifecycle {
  connect(): Promise<void>
  disconnect(): Promise<void>
}

// PK-keyed + raw escape hatch. Methods independently optional.
interface AdapterCrud<C> {
  findByPk?   (schema: AnySchema, pk: unknown, cfg: C): Promise<Record<string, unknown> | null>
  insertMany? (schema: AnySchema, rows: Record<string, unknown>[], cfg: C): Promise<Record<string, unknown>[]>
  updateByPk? (schema: AnySchema, pk: unknown, ops: UpdateOp[], cfg: C): Promise<Record<string, unknown> | null>
  deleteByPk? (schema: AnySchema, pks: unknown[], cfg: C): Promise<number>
  raw?        <T>(command: unknown, params?: unknown[]): Promise<T>
}

// Filter-based. Methods independently optional. Bag presence requires non-empty queryableOps.
interface AdapterQueryable<C> {
  findMany?   (schema: AnySchema, q: QueryGroup, opts: QueryOptions, cfg: C): Promise<Record<string, unknown>[]>
  updateMany? (schema: AnySchema, q: QueryGroup, ops: UpdateOp[], cfg: C): Promise<Record<string, unknown>[]>
  deleteMany? (schema: AnySchema, q: QueryGroup, cfg: C): Promise<number>
}

interface AdapterTransactional {
  session<T>(fn: () => Promise<T>): Promise<T>
}
```

Notes:
- A single `updateMany` adapter method handles whatever ops are in the adapter's `updateOps` declaration. No separate set-flavor / atomic-flavor split.
- All methods in `crud` and `queryable` bags are independently optional. Repo surface narrows per-method (no `findByPk` declared → `repo.findByPk` is `never`).
- `queryable` bag's *presence* requires non-empty `queryableOps` (factory compile error otherwise — methods that take `QueryGroup` are meaningless without filter ops declared).
- Read-only / write-only / query-only adapters are first-class — they declare only the methods they support.

### Adapter factory shape (preferred authoring API)

```ts
const PostgresAdapter = defineAdapter({
  config:        {} as PgCfg,
  queryableOps:  ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'like', 'exists', 'contains', 'ncontains'],
  updateOps:     ['set', 'inc', 'mul', 'min', 'max', 'unset', 'push', 'pull', 'patch'],

  lifecycle:     { connect, disconnect },
  crud:          { findByPk, insertMany, updateByPk, deleteByPk, raw },
  queryable:     { findMany, updateMany, deleteMany },
  transactional: { session },
})

const FirebaseAdapter = defineAdapter({
  config:       {} as FirebaseCfg,
  queryableOps: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'nin'], // honest: no like/contains server-side
  updateOps:    ['set'],                                              // atomic FieldValue.* via raw
  // no lifecycle — Firestore lazy-connects, no explicit connect/disconnect
  crud:         { findByPk, insertMany, updateByPk, deleteByPk, raw },
  queryable:    { findMany, updateMany, deleteMany },
})

const KVOnlyAdapter = defineAdapter({
  config:    {} as KVCfg,
  updateOps: ['set'],
  lifecycle: { connect, disconnect },
  crud:      { findByPk, insertMany, updateByPk, deleteByPk, raw },
  // no queryable bag → pure key-value
})

const ReadOnlyWarehouseAdapter = defineAdapter({
  config:       {} as WHCfg,
  queryableOps: ['eq', 'gt', 'gte', 'lt', 'lte', 'in'],
  lifecycle:    { connect, disconnect },
  crud:         { findByPk, raw },           // read + escape hatch only
  queryable:    { findMany },                // read-only filter
})
```

The `defineAdapter` factory's argument type enforces:
- non-empty `queryableOps` requires a `queryable` behaviour bag (TS error if missing)
- ops listed in `queryableOps` / `updateOps` must be drawn from the closed canonical sets
- `transactional` bag is optional; presence enables `session()` on the Repo
- omitted op lists default to `readonly []` — no `as const` needed at call sites (factory uses `const` type parameters)

### Repo type narrowing

```ts
type RepoSurface<S extends AnySchema, A> =
  & {
      // Always-on storage surface
      findByPk(pk: unknown): Promise<SchemaOutput<S> | null>
      insertOne(row: SchemaInput<S>): Promise<SchemaOutput<S>>
      insertMany(rows: SchemaInput<S>[]): Promise<SchemaOutput<S>[]>
      deleteByPk(pk: unknown): Promise<boolean>
      raw: A['raw']
      // updateByPk types to never if updateOps is empty
      updateByPk: A['updateOps']['length'] extends 0
        ? never
        : (pk: unknown, ...ops: UpdateOp<S, A>[]) => Promise<SchemaOutput<S> | null>
    }
  & (A['queryableOps']['length'] extends 0
      ? {}
      : {
          findOne (q: WhereFactory): Promise<SchemaOutput<S> | null>
          findMany(q: WhereFactory, opts?: QueryOptions): Promise<SchemaOutput<S>[]>
          // updateOne / updateMany are typed never if updateOps is empty
          updateOne : A['updateOps']['length'] extends 0
            ? never
            : (q: WhereFactory, ...ops: UpdateOp<S, A>[]) => Promise<SchemaOutput<S> | null>
          updateMany: A['updateOps']['length'] extends 0
            ? never
            : (q: WhereFactory, ...ops: UpdateOp<S, A>[]) => Promise<SchemaOutput<S>[]>
          deleteOne (q: WhereFactory): Promise<boolean>
          deleteMany(q: WhereFactory): Promise<number>
        })
  & (A extends { transactional: { session: any } }
      ? { session<T>(fn: () => Promise<T>): Promise<T> }
      : {})
```

(Extensions merge dropped — adapter-specific power is `raw` only.)

### Update operation list (user-facing helpers)

```ts
import { set, inc, mul, min, max, unset, push, pull, patch } from 'equipped/orm'

await repo.updateMany(
  q => q.eq(User.fields.id, 'u1'),
  set({ name: 'Alice', email: 'a@b.com' }),       // values validated against schema pipes
  inc(User.fields.views, 1),                       // not validated
  push(User.fields.tags, 'rust'),                  // not validated
  unset(User.fields.deprecatedField),
)

// PK-keyed — same op list, no filter
await repo.updateByPk('u1', set({ name: 'Alice' }), inc(User.fields.views, 1))
```

Discriminant types:

```ts
type UpdateOp<S, A> =
  | ('set'   extends A['updateOps'][number] ? SetOp<S>   : never)
  | ('inc'   extends A['updateOps'][number] ? IncOp<S>   : never)
  | ('mul'   extends A['updateOps'][number] ? MulOp<S>   : never)
  | ('min'   extends A['updateOps'][number] ? MinOp<S>   : never)
  | ('max'   extends A['updateOps'][number] ? MaxOp<S>   : never)
  | ('unset' extends A['updateOps'][number] ? UnsetOp<S> : never)
  | ('push'  extends A['updateOps'][number] ? PushOp<S>  : never)
  | ('pull'  extends A['updateOps'][number] ? PullOp<S>  : never)
  | ('patch' extends A['updateOps'][number] ? PatchOp<S> : never)

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

### Canonical filter operator set (closed)

```
eq · ne · gt · gte · lt · lte · in · nin · like · exists · contains · ncontains · and · or
```

(Today's code uses `nexists` and `nin`; README says `notExists` / `notIn`. Reconcile in implementation pass.)

---

## Cross-cutting principles agreed

- **Factory > class** for adapter (and likely Repo) authoring APIs.
- **No silent emulation.** Capabilities are honest; missing means missing. Extensions or `raw` for DB-specific power.
- **Type system is the contract.** Capability mismatches are compile errors, not runtime throws, wherever feasible.
- **Capabilities are per-op subsettable.** Adapters declare exactly which ops they support via `queryableOps` / `atomicOps` literal lists. TS narrows the surface accordingly. (Revised from earlier all-or-none rule — see Q4.)
- **Validation lives once, in the package**, not duplicated across adapters. The boundary normalisation pass (Q5.2) enforces structural guarantees (field existence, op closure, logical names); filter *value* types are a TypeScript-only contract — no runtime coercion.
- **Always throw, never silently drop.** Empty groups, missing fields, unknown ops fail loudly. No silent short-circuits, no "match-all" or "match-none" fallbacks at boundaries.
- **Migrations / aggregates / streaming are out of scope** for this layer.

---

## Continuation prompt for the next agent

> I'm continuing a `/grill-me` design conversation about redesigning the ORM in `equipped` (`src/orm`). Read `src/orm/REDESIGN-NOTES.md` for the locked decisions, unresolved branches, and code shapes so far. Resume the grill at the next unresolved decision (Q5.4 — one update method vs two), then drill the not-yet-explored branches in the order listed under "Branches NOT YET DRILLED". Honour the locked principles, especially: factory > class for authoring APIs, no silent emulation, capabilities are per-op subsettable (not all-or-none), filter-value types are a TS-only contract (no runtime coercion), always throw never silently drop.
