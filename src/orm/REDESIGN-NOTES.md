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

### Q3.x — authoring style: factory wrapping a builder chain (REVISED post-Q9)

**Canonical pattern: `defineX(callback)` where the callback receives a builder and returns the chained result.** Applied to every API definition in the ORM (`defineSchema`, `defineRelations`, `defineAdapter`, `defineRepo`).

```ts
const X = defineX((b) => b
  .step1(...)
  .step2(...)
  .step3(...)
)
```

**Why builder-chain over flat object literal:**
- Type accumulation step-by-step: each method narrows the accumulated builder type; later methods see prior declarations (e.g., `.computed()`'s `deps` constrained to prior `.field()` names; `.queryable(bag)` constrained by prior `.queryableOps(...)`).
- Per-step coherence checks: violations fire at the offending call line, not at the close.
- IDE autocomplete reveals what's valid next at each step.
- Visual uniformity across the package — schema, relations, adapter, orm all read the same way.

**Compile-time duplicate-call / duplicate-key safety via the never-trick:**

```ts
class XBuilder<Acc extends Record<string, unknown> = {}> {
  step<K extends string>(
    name: K extends keyof Acc ? never : K,   // ← duplicate-key safety
    ...
  ): XBuilder<Acc & Record<K, ...>> { ... }
}
```

If a user attempts `.step('foo', ...).step('foo', ...)`, the second `'foo'` resolves to `never` and TS errors at the offending line.

**Rest-args for op lists:** `.queryableOps('eq', 'ne', 'gt')` instead of `.queryableOps(['eq', 'ne', 'gt'])`. TS 5.0+ `const` type parameter (`<const Ops extends readonly OpName[]>`) preserves literal types in rest-args without `as const`. Same for `.updateOps(...)`.

**Things that stay as direct calls (NOT builders):**
- `repo.findByPk / findOne / updateMany / upsertOne / ...` — invocation methods (schema-per-call).
- `repo.session(fn)` — transaction entry.
- `set(...) / inc(...) / hasMany(...) / belongsTo(...)` — op/descriptor helper functions.

**The principle: builder-chain for declarative artifact construction; direct calls for invocation/operations.**

**Durable preference (revised):** builder-chain factories (`defineX(b => b.x().y())`) are the default for future API definition decisions in this package. Flat-object factories deferred unless a concrete reason to deviate. (Memory updated.)

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
queryableOps:  'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'notIn' | 'like' | 'exists' | 'notExists' | 'contains' | 'notContains'
updateOps:     'set' | 'inc' | 'mul' | 'min' | 'max' | 'unset' | 'push' | 'pull' | 'patch' | 'upsert'
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

## Decisions LOCKED (continued)

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

**Decision: two methods.** `repo.updateOne(schema, filter, ...ops): T | null` + `repo.updateMany(schema, filter, ...ops): T[]`. Symmetric with the locked `findOne` / `findMany` and `deleteOne` / `deleteMany` pairs. Adapter-level `LIMIT 1` / native `updateOne` is faster than scanning all matches when the user only wants one. `updateOne` with a non-unique filter selects "first match wins" (matches today's Mongo / PG-with-LIMIT-1 semantics).

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

### Q6 — Repo construction & multi-tenancy (LOCKED — REVISED post-Q9.5)

**Decision: single-Repo D + user-provided `ContextSource`.** Library imports zero `node:async_hooks`. User wires their own propagation mechanism (ALS, Hono context, DI container, explicit threading) and provides a `ContextSource` to the repo.

The earlier multi-Repo blend was overturned because preloads + multi-tenancy created an unfixable footgun: `withConfig` derivations didn't propagate to preloaded queries (preload framework looked up the originally-registered repo from an orm registry). Subagent research (multi-source: Drizzle, Prisma, TypeORM, Sequelize, MikroORM, Kysely + 2026 edge-runtime ALS state + non-ALS context propagation patterns) converged on the hook-based pattern: ORM core ships zero ALS dependency; user owns context propagation. This matches Prisma's `$extends` model and aligns with TypeORM's March 2026 rejection of native ALS support (PR #11199).

#### Shape

```ts
const repo = defineRepo((r) => r
  .adapter(PostgresAdapter)
  .resolve((schema) => ({ table: schema.name }))
  .context(myContextSource)             // optional; if absent, no transform applied per query
)
```

**Schema arg per call** (not per-schema typed repos):

```ts
await repo.findByPk(UserSchema, 'u1')
await repo.findOne(UserSchema, q => q.eq(UserSchema.fields.id, 'u1'))
await repo.findMany(UserSchema, q => q.gt(UserSchema.fields.age, 18), {
  preload: [UserRels.orders]            // preloads work — one Repo, one cfg-resolution path
})
await repo.insertOne(UserSchema, { ... })
await repo.updateOne(UserSchema, q, set({...}))
await repo.updateByPk(UserSchema, 'u1', set({...}), inc(UserSchema.fields.views, 1))
await repo.deleteByPk(UserSchema, 'u1')

await repo.session(async () => {
  await repo.updateOne(UserSchema, q, set({...}))
  await repo.insertOne(OrderSchema, {...})
})
```

#### `ContextSource` contract

Library exposes:

```ts
type ConfigTransform<C> = (cfg: C, schema: AnySchema) => C

type ContextSource<C> = {
  get: () => ConfigTransform<C> | null
}
```

The library calls `contextSource.get()` per query, applies the returned transform on top of the resolved config (`base resolve → context transform`), hands the result to the adapter. **`run`/scope-entry is owned by the user**; library never enters or runs ALS scopes itself.

#### Configuration resolution order (locked)

For each query: `base resolve(schema) → contextSource.get()?(cfg, schema)`.

1. **Base resolve** — `defineRepo(.resolve((schema) => Cfg))` runs; produces base cfg per schema.
2. **Context transform** — `contextSource.get()` runs per query; if non-null, the returned `ConfigTransform` is applied on top of base cfg.

Same flow for every query, including preloaded sub-queries. No registry, no per-schema typing, no `withConfig`.

#### Multi-tenancy patterns (user picks per their stack and runtime)

**Node + ALS (typical):**
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

export function runInTenant<T>(id: string, fn: () => Promise<T>): Promise<T> {
  return tenantStore.run({ id }, fn)
}

const repo = defineRepo((r) => r
  .adapter(PgAdapter)
  .resolve((s) => ({ table: s.name }))
  .context(tenantContext)
)

// Middleware
app.use((req, _res, next) => runInTenant(req.header('x-tenant')!, () => next()))
```

**Cloudflare Workers + Hono context-storage:**
```ts
import { contextStorage, getContext } from 'hono/context-storage'

const tenantContext = {
  get: () => {
    const c = getContext()
    const id = c.var.tenantId
    return id ? (cfg) => ({ ...cfg, table: `t_${id}_${cfg.table}` }) : null
  },
}
```

**DI container (NestJS / tsyringe / awilix):**
```ts
const tenantContext = {
  get: () => {
    const t = container.get<Tenant | null>('tenant')
    return t ? (cfg) => ({ ...cfg, table: `t_${t.id}_${cfg.table}` }) : null
  },
}
```

**Explicit threading (no global mechanism):**
```ts
let active: ConfigTransform | null = null
const tenantContext = { get: () => active }

export async function withTenant<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = active
  active = (cfg) => ({ ...cfg, table: `t_${id}_${cfg.table}` })
  try { return await fn() } finally { active = prev }
}
```
(Safe for fully-sequential code; breaks under concurrent requests in same isolate.)

In all patterns: handler/service code reads as if single-tenant. Tenant prefix flows through preloads automatically because the same `contextSource.get()` is called for every query, including downstream preload queries.

#### Cross-schema transactions

`repo.session(async () => ...)` calls the adapter's `session(fn)`. Inside `fn`, every `repo.<method>(schema, ...)` call resolves through the same single Repo, hits the adapter, picks up the tx connection from adapter-internal ALS (Q8). Cross-schema, cross-table all work.

If a tenant scope wraps a session: tenant transform is applied on top of base cfg for every query inside the session. Both layers compose: tenant scope (user-owned) → session (adapter-internal). No interaction issues.

#### Footgun documented (not enforced)

If user forgets to wire the tenant middleware on a route, `contextSource.get()` returns `null` and queries silently hit the un-prefixed base table. Two user-side mitigations to document:

- Throw-on-missing inside `contextSource.get()` (`if (!t) throw`) — fail loud for any untenanted query.
- Sentinel scope (`tenantStore.run({ id: '__untenanted__' }, ...)`) for legitimate untenanted code (admin routes, migrations) so missing-tenant is impossible by construction.

Library doesn't enforce either; admin/migration routes have legitimate untenanted use.

#### Why this beats library-side ALS (the original D plan)

| | Library-side ALS | Hook-based (locked) |
|---|---|---|
| Library imports `node:async_hooks` | yes | **no** |
| Edge-runtime portable | depends on runtime | yes |
| User-pluggable for non-ALS strategies | no | yes |
| Multi-tenancy "just works" | yes (built-in) | one-time setup (~10 lines) |
| Thenable-bug exposure | direct (library returns thenables → ALS may lose context) | user-owned (their hook, their problem) |
| ORM-industry alignment | older pattern (Sequelize) | modern pattern (Prisma `$extends`, TypeORM PR #11199 rejected, Kysely's `withSchema`) |

#### Naming (locked)

- Library factory: **`defineRepo`** (matches today's `Repo.from`; "Orm" was a Q6-blend invention dropped here).
- Builder methods: **`.adapter(...)`**, **`.resolve(schema => Cfg)`**, **`.context(contextSource)`**.
- Context-source contract: **`{ get: () => ConfigTransform | null }`**. No `run` — user owns scope-entry.
- Transaction entry: **`repo.session(fn)`** (matches `AdapterTransactional.session`).
- Schema-per-call methods: `repo.findByPk(schema, pk)`, `repo.findOne(schema, q)`, `repo.findMany(schema, q, opts?)`, `repo.insertOne(schema, row)`, `repo.insertMany(schema, rows)`, `repo.updateOne(schema, q, ...ops)`, `repo.updateMany(schema, q, ...ops)`, `repo.updateByPk(schema, pk, ...ops)`, `repo.deleteByPk(schema, pk)`, `repo.deleteOne(schema, q)`, `repo.deleteMany(schema, q)`, `repo.raw(...)`.

#### What was removed (vs Q6 multi-Repo blend)

- ❌ `defineOrm` two-tier shape — collapsed into single `defineRepo`.
- ❌ `orm.repo(schema, cfg)` factory — replaced by `defineRepo(.resolve(...))` + schema-per-call methods.
- ❌ `repo.withConfig(transform)` — no per-Repo derivation; user wraps a scope at the application layer instead.
- ❌ Orm registry / `repoFor(schema)` lookup — single Repo, no registry needed.
- ❌ Per-schema typing (`Repo<S, A>`) — back to `Repo<A>` with schema-arg-per-call.
- ❌ Built-in `scope` hook on the orm root — replaced by `ContextSource` wired by the user.

#### Out of scope / deferred

- **Per-field adapter config** (PG types, Mongo index hints): no canonical in-scope use case; deferred. DDL/migrations remain out of scope per Q4.4g.
- **Schema-side adapter binding**: rejected. Schema is fully relations- and adapter-agnostic.

#### Costs accepted

1. **Schema-arg-per-call ergonomics.** `repo.findMany(UserSchema, q)` instead of `userRepo.findMany(q)`. Per-call return types still narrow correctly via TS generics; IDE autocomplete is slightly worse (you have to type the schema arg first to get accurate field hints).
2. **One-time `~10 lines` of user setup** to wire ALS (or Hono context, or DI). Library can't make multi-tenancy work without the user wiring something.
3. **No per-schema config divergence** at the Repo layer — a schema's config is whatever `resolve(schema)` returns. Different configs require different repos or context-driven transforms.

### Q7 — Validation flow (LOCKED)

**Where validation runs:**
- **At Repo method entry, before any adapter call.** Adapters never re-validate.
- `insertOne` / `insertMany`: `validateInsert(schema, row)` per row.
- `updateOne` / `updateMany` / `updateByPk`: walk the op list — apply auto-bump (Q7.α), pipe-validate each `SetOp.values` per-field, atomic op operands pass through unvalidated.
- Filter argument: `assertNormalisedFilter(schema, q)` — A + B + F from Q5.2 (existence, op closure, logical names). No value validation.

**`onCreate` / `onUpdate` integration with op-list update API (Q7.α):**
- **Generalize today's "ops on a field suppress that field's `onUpdate`" rule.** If *any* op (SetOp or atomic) touches a field, suppress that field's `onUpdate` generator. For schema fields with `onUpdate` not touched by any op, the package implicitly appends a `set({ <field>: <onUpdate value> })` op.
- **Auto-bump SetOp values are pipe-validated** (same rule as user-supplied set values — generators can return invalid data; we want to catch that).
- Implementation: walk the op list collecting `touchedFields = Set<fieldName>` from `SetOp.values` keys + atomic ops' `field`. For each schema field with `onUpdate` not in `touchedFields`, append implicit `SetOp({ <field>: <onUpdate()> })`. Then run pipe validation per the locked rules.
- `onCreate` for inserts unchanged (today's `validateInsert` behaviour).

**Error shape:**
- **Use `v.validate` (non-throwing) instead of `v.assert`.** Valleyed signature: `v.validate(pipe, input) → { value, valid: true } | { error: PipeError, valid: false }`.
- **New error class `OrmValidationError extends EquippedError`** carries the pipe errors. Single error type for users to catch (consistent with the rest of the package's `EquippedError` family at `repo.ts:308-314`, `preloads.ts:89-100`).
- Error shape:
  ```ts
  class OrmValidationError extends EquippedError {
    kind: 'validation'
    schema: string                    // schema.name
    operation: 'insertOne' | 'insertMany' | 'updateOne' | 'updateMany' | 'updateByPk'
    failures: Array<{
      opIndex?: number                // for update calls — which op in the list
      rowIndex?: number               // for insertMany — which row
      field?: string                  // which field, when known
      cause: PipeError                // original valleyed error
    }>
  }
  ```

**Multi-error collection (collect-all):**
- Today's `v.object({...})` already collects all field errors per-row. Stays the same.
- New: for update calls with multiple ops, walk all ops accumulating failures. Throw one `OrmValidationError` with the full `failures` list at the end. Don't fail-fast on first op.
- For `insertMany`, accumulate failures across rows (each row's `v.validate` result → push failures with `rowIndex`).
- Keeps consistency with locked Q5.1 conflict-rejection (which also collects all conflicts before throwing).

### Q8 — Transactions / `session` shape (LOCKED)

**Shape: simple callback** (`repo.session<T>(fn: () => Promise<T>): Promise<T>`).

- Drizzle / Knex / Prisma idiom; native fit for async/await composition.
- Ecto.Multi-style chained operations rejected — Elixir-specific idiom (depends on pipe operator + tagged tuples) that doesn't add value in JS land.
- Matches the locked `AdapterTransactional.session<T>(fn): Promise<T>` adapter contract.

**Rollback: throw to rollback.** Any uncaught throw in the callback rolls back. No explicit `tx.rollback()` method. Users wanting silent rollback throw a sentinel error and catch it outside `session()`. One mechanism, idiomatic JS.

**Repo binding: adapter-internal AsyncLocalStorage (or runtime equivalent).**
- Adapter implements its own session-context propagation. Library never imports `node:async_hooks`.
- Adapter's `session(fn)` acquires connection → BEGIN → stores tx connection in adapter-internal ALS → runs `fn` → COMMIT (or ROLLBACK on throw).
- All adapter methods (`findByPk`, `findMany`, `updateMany`, etc.) read the adapter's ALS first; if a tx connection exists, route through it; otherwise grab from pool.
- All Repo instances sharing the same adapter inside `session(fn)` are tx-bound automatically. User's existing repo references work unchanged.
- Library stays runtime-portable. Adapters on edge runtimes use the runtime's mechanism (Workers' tx-per-request, etc.) instead of ALS.
- **Asymmetry with Q6's `scope` hook accepted.** `scope` is pluggable because not every user needs multi-tenancy and runtimes vary; sessions are universal but the *mechanism* still varies — adapter-side ALS keeps the library portable while consolidating ALS code per-adapter.

**Nested sessions: framework delegates to adapter.**
- `repo.session(...)` inside another `repo.session(...)` → framework just calls `adapter.transactional.session(fn)` again.
- Adapter decides its own nesting behavior (PG can use savepoints, Mongo has its own semantics, Firebase has no transactions).
- Adapter author documents nesting behavior in the adapter's README.
- No framework-level rule.

**Isolation levels: out of scope; DB default wins.**
- No `isolation` option on `repo.session(fn)`.
- No `defaultIsolation` declaration required on adapters.
- Each DB uses whatever default level its `BEGIN` statement implies (PG: `READ COMMITTED`, MySQL InnoDB: `REPEATABLE READ`, SQLite: `SERIALIZABLE`, Mongo 5.0+: snapshot, etc.).
- Inconsistent across adapters by design; same behavior every other JS ORM has.
- Users needing specific isolation use `raw('BEGIN ISOLATION LEVEL ...')` or adapter-specific session config.
- Slot-in answer if real demand emerges later: per-adapter `isolationLevels: [...] as const` declaration + optional `isolation` arg on `session()`. Force-uniform-value rejected (SQLite/Mongo/Firebase can't comply).

**Cross-schema transactions:**
- Q6 was revised to single-Repo (one repo handles all schemas); cross-schema transactions just work because every schema-per-call goes through the same adapter, which `repo.session(fn)` tx-binds. Tx state lives in the adapter, not in the Repo.

**Return value:**
- `session<T>(fn): Promise<T>` returns the callback's return value after a successful commit. If commit fails (e.g., serialization error), `session` rejects with the commit error rather than the value.

### Q10 — Naming drift / API reconciliation (LOCKED)

#### Filter operator names (Q10.1)

**Method names and enum values:**

| Method | Enum value | Notes |
|---|---|---|
| `eq` | `'eq'` | unchanged |
| `ne` | `'ne'` | unchanged |
| `gt` / `gte` / `lt` / `lte` | `'gt'` / `'gte'` / `'lt'` / `'lte'` | unchanged |
| `in` | `'in'` | positives keep short names |
| `notIn` | `'notIn'` | renamed from `nin` |
| `like` | `'like'` | unchanged |
| `exists` | `'exists'` | unchanged |
| `notExists` | `'notExists'` | renamed from `nexists`; **own enum value** (Q10.4 below) — no longer a boolean form of `exists` |
| `contains` | `'contains'` | unchanged |
| `notContains` | `'notContains'` | renamed from `ncontains` |
| `and` / `or` | `'and'` / `'or'` | structural combinators |

Convention: positives stay short (`in`, `exists`, `contains`); negatives use `notX` prefix (English, not SQL `nX` shorthand). Enum values match method names exactly so the wire protocol is self-describing.

#### Q10.4 — `notExists` is its own enum value (not a boolean form of `exists`)

- Today's `nexists` method writes `WhereOp.exists` with `value: false`. Replaced by a dedicated `WhereOp.notExists` op with no value payload.
- Symmetric with `notIn` / `notContains` which each have their own enum values.
- Adapter pattern-match becomes `case 'notExists':` directly — no boolean inspection.
- `where.value` is now meaningful for every op or absent (no quirk where one op's "value" is a flag).

#### `QueryGroup.raw` dropped (Q10.2)

- README claimed `QueryGroup.raw(...)` filter escape hatch — code never had it.
- **Locked: not added.** Custom adapter-specific filter shapes go via the adapter's `raw(...)` method (Repo-level), not on the QueryGroup tree. Consistent with extensions-deferred decision.

#### Repository API surface (Q10.3 — README ↔ locked design reconciliation)

README's Repository API list is updated to match locked decisions:

**Added (from Q5.5):**
- `findByPk(pk)` (renamed from `getByPk`)
- `updateByPk(pk, ...ops)` (NEW — locked Q5.5)
- `deleteByPk(pk)` (NEW on Repo surface)

**Removed:**
- `upsertOne` — deferred (Q5.5 deferred upsert; not yet decided where it lands).
- `resolve` Repo method — replaced by Q6's `defineRepo(.resolve(schema => Cfg).context(ctxSource))` + user-owned scope-entry. The old `repo.resolve(transformer, fn)` AsyncLocalStorage pattern is gone (library imports zero `node:async_hooks`).

**Stays:**
- `findOne`, `findMany`, `insertOne`, `insertMany`, `updateOne`, `updateMany`, `deleteOne`, `deleteMany`, `raw`.

**Moved to Orm root (per Q6 / Q8):**
- `session(fn)` — `repo.session(fn)` (single-Repo handles all schemas; cross-schema works because all schema-per-call routes through the same adapter).

#### Adapter contract (Q10.5 — README ↔ locked design reconciliation)

Old README mentions `OrmAdapter` class with `connect` / `disconnect` / `use(schema, config) → OrmUse` / `session`. All replaced:

- **`OrmAdapter` class → `defineAdapter` factory** (Q3.x).
- **`connect` / `disconnect`** → optional `lifecycle` bag (Q5.5).
- **`use(schema, config) → OrmUse`** → direct method bags `crud` / `queryable` invoked with `(schema, args, cfg)`. The `OrmUse` type is retired.
- **`session(fn)`** → optional `transactional: { session }` bag (Q8).

#### Implementation pass

Branch #7 closure means a follow-up implementation pass needs to:

1. Rename `nin` → `notIn`, `ncontains` → `notContains`, `nexists` → `notExists` (method names).
2. Rename `WhereOp.nin` → `'notIn'`, `WhereOp.ncontains` → `'notContains'`, add `WhereOp.notExists` and remove the boolean form on `'exists'`.
3. Update tests and the in-memory / mongo / postgres adapter compilers (`compileMongoQuery` etc.) for the new enum names.
4. Rewrite README "Repository API" + "Query API" + "Adapters" sections to match locked design.
5. Drop `QueryGroup.raw` mention from README.
6. Add `upsertOne(schema, q, insert, ...ops)` to the Repository API list (Q12 locked).
7. Drop the old `resolve` Repo method from the Repository API list. Document the new `defineRepo(.resolve(schema => Cfg).context(ctxSource))` shape and the user-provided `ContextSource` hook for multi-tenancy / scope propagation. Library imports zero `node:async_hooks`.
8. Add `findByPk` / `updateByPk` / `deleteByPk` to Repository API list.

### Q9 — Relations declaration shape (LOCKED) + builder-chain upgrade

**Q9.1 — Separate (Drizzle-style) declarations.** Today's pattern stays: relations live in a distinct artifact from the schema. Schema = pure shape; relations = wiring; adapter binding = composition. Three layers, three responsibilities. Avoids cyclic forward-reference headaches that inline (Ecto) would force in JS without macros.

**Q9.2 — Builder-chain factory (F1) with the never-trick for duplicate-key safety.**

```ts
const UserRelations = defineRelations(UserSchema, (rel) => rel
  .hasMany('posts', PostSchema, 'userId')
  .belongsTo('org', OrgSchema, 'orgId')
  .hasOne('profile', ProfileSchema, 'userId')
)
```

Type-level duplicate-key prevention via `name: K extends keyof Acc ? never : K`:

```ts
class RelationsBuilder<S extends AnySchema, R extends Record<string, AnyDescriptor> = {}> {
  hasMany<K extends string, T extends AnySchema, FK extends SchemaKey<T>>(
    name: K extends keyof R ? never : K,
    target: T,
    foreignKey: FK,
  ): RelationsBuilder<S, R & Record<K, ManyRelation<...>>> { ... }
  // belongsTo, hasOne — same trick
}
```

Calling `.hasMany('posts', ...).hasMany('posts', ...)` produces a TS error: the second `'posts'` resolves to `never`.

**Q9 → Q3.x revision: builder-chain is the canonical pattern for ALL API definitions.** See revised Q3.x above. Applies to:
- `defineSchema('users', (s) => s.pk(...).field(...))` (rename of `Schema.from(...)`)
- `defineRelations(source, (b) => b.hasMany(...))`
- `defineAdapter((a) => a.config(...).queryableOps(...).crud({...}))`
- `defineRepo((r) => r.adapter(...).resolve(...).context(...))`

Direct calls (not builders): `repo.findByPk(...)` (and other invocation methods, schema-per-call), `repo.session(...)`, op/descriptor helper functions (`set`, `inc`, `hasMany`, `belongsTo`, etc.).

#### Q9.3 — FK refs (LOCKED)

**Decision: `Field<T, N, S>` refs only. No string keys. Target schema inferred via phantom parent-schema type for `hasMany` / `hasOne`. Source-thunk callback for source-side fields. `defineRelations` callback signature is `(rel, src) => ...`.**

**Phantom type on `Field`:**

```ts
class Field<T = unknown, Name extends string = string, S extends AnySchema = AnySchema> {
  declare readonly __valueType?: T
  declare readonly __schema?: S      // phantom; type-only, zero runtime cost
  readonly name: Name
  readonly path: readonly string[]
}
```

Schema's `fields` accessor returns Fields tagged with the schema:
```ts
class Schema<...> {
  get fields(): { [K in keyof FieldDefs]: Field<Output<FieldDefs[K]>, K, this> }
}
```

**Builder method shapes:**

```ts
hasMany<K extends string, T extends AnySchema, FK extends Field<any, any, T>>(
  name: K extends keyof R ? never : K,
  fk: FK,                    // Target inferred via T (FK's parent)
)

hasOne<K extends string, T extends AnySchema, FK extends Field<any, any, T>>(
  name: K extends keyof R ? never : K,
  fk: FK,                    // Target inferred via T
)

belongsTo<K extends string, FK extends Field<any, any, S>, T extends AnySchema>(
  name: K extends keyof R ? never : K,
  fk: FK,                    // FK Field on source (S)
  target: T,                 // Target explicit — FK Field's parent is source, not target
  references?: Field<any, any, T>,   // Optional, defaults to target's PK
)
```

**Source-thunk callback:**

```ts
function defineRelations<S extends AnySchema, R>(
  source: S,
  build: (rel: RelationsBuilder<S>, src: S) => RelationsBuilder<S, R>,
): Relations<S, R>
```

`src` is bound to the source schema; use it for source-side fields inside the callback so `UserSchema` is named only once (at the `defineRelations` call).

**Example:**

```ts
const UserRels = defineRelations(UserSchema, (rel, src) => rel
  .hasMany('posts', PostSchema.fields.userId)                    // FK on target → target inferred
  .hasOne('profile', ProfileSchema.fields.userId)                // FK on target → target inferred
  .belongsTo('org', src.fields.orgId, OrgSchema)                 // FK on source → target explicit
  .belongsTo('mgr', src.fields.managerId, UserSchema)            // self-reference: same schema as target
)
```

**FK ↔ PK type-match enforced:** With Field-only refs, builder constrains FK and references-field types to match. A string FK pointing at a number PK is now a compile error — bug class invisible under string-key form.

**Why `belongsTo` requires an explicit target:** asymmetry mirrors physical FK ownership. `hasMany` / `hasOne` have FK on target (FK Field's parent IS the target → inferable). `belongsTo` has FK on source (FK Field's parent is the source → target unanchored at the type level → must be passed). Field-level `.references()` rejected — the user wants schema fully relations-agnostic; no relational hints on the schema declaration.

**Schema stays fully relations-agnostic:** no `.references()` chain on `.field()`, no FK→target hints on schema. All relational concerns live in `defineRelations`. Avoids the cyclic forward-reference problem that inline declarations would force.

#### Q9.4 — Many-to-many (LOCKED)

**Decision: explicit join schemas. No sugar.** Today's pattern stays.

```ts
const PostTagSchema = defineSchema('post_tags', (s) => s
  .pk('id', v.string(), () => 'pt-id')
  .field('postId', v.string())
  .field('tagId', v.string())
)

const PostRels = defineRelations(PostSchema, (rel, src) => rel
  .hasMany('postTags', PostTagSchema.fields.postId)
)

const TagRels = defineRelations(TagSchema, (rel, src) => rel
  .hasMany('postTags', PostTagSchema.fields.tagId)
)

const PostTagRels = defineRelations(PostTagSchema, (rel, src) => rel
  .belongsTo('post', src.fields.postId, PostSchema)
  .belongsTo('tag', src.fields.tagId, TagSchema)
)
```

User accesses tags from a post via two-step preload (`post.postTags[].tag`). No `manyToMany` / `hasManyThrough` helper.

**Reason:** join tables frequently carry their own data (e.g. `created_at` on `post_tags`, role on a `user_roles` join). Sugar that hides the join schema obscures this. Explicit form keeps the join as a first-class entity.

#### Q9.5 — Orm/Repo integration for preloads (RESOLVED via Q6 revision)

The original Q9.5 question (how does the preload framework find the target Repo given multi-Repo) **dissolved** when Q6 was reverted to single-Repo D. With one Repo handling all schemas, preloads call `repo.findMany(targetSchema, ...)` directly — no registry, no `repoFor` lookup, no footgun.

The user-provided `ContextSource` flows through preloads automatically because every query (top-level or preloaded) goes through the same per-query config-resolution path: `base resolve(schema) → contextSource.get()?.(cfg, schema)`.

#### Q9.6 — Composite foreign keys (OUT OF SCOPE)

**Decision: composite FKs and composite PKs are not supported.** Single-FK and single-PK only.

Reasons:
- No locked use case forces it. The most plausible composite-FK case (multi-tenancy with `(tenant_id, entity_id)`) is handled by Q6's hook-based `ContextSource` config transform — tenants don't appear as columns.
- Composite PK would affect the entire CRUD-by-PK surface (`findByPk` / `updateByPk` / `deleteByPk` all take tuples; adapter contract grows). Significant blast radius.
- DDL out of scope (Q4.4g) — framework doesn't generate composite key constraints.
- Modern TypeScript apps trend toward surrogate UUIDs + composite UNIQUE indexes rather than composite PKs.
- Mongo / Firebase don't have native composite FKs — universal-adapter rough fit.

**Users with composite-key schemas:** model with surrogate UUIDs + composite UNIQUE indexes (modern alternative documented in Q9.6 grill). For genuine composite-key requirements that can't be modelled this way, use `raw`.

#### Q9 sub-questions resolved

- **Self-referential relations**: confirmed working — pass same schema as target. No special case needed.

### Q11 — Schema field-type ↔ adapter compatibility (LOCKED)

**Decision: `supportedValueTypes` literal list with TS-level compile-time enforcement.** Same pattern as `queryableOps` / `updateOps` (Q4): closed canonical set, adapter subsets a portion, builder-chain factory method, TS narrowing at the call site.

#### Closed canonical set

```ts
type ValueType =
  | 'string'    // → JS string
  | 'number'    // → JS number
  | 'boolean'   // → JS boolean
  | 'null'      // → null
  | 'object'    // → record-shaped JS object (incl. Map encoded as object)
  | 'array'     // → JS array (incl. Set encoded as array)
  | 'date'      // → Date instance
```

7 tags. **Closed and final.** Custom value shapes fall under `'object'` (record-like) or `'array'` (list-like).

`'binary'` (Uint8Array / Buffer) and `'bigint'` are **out of scope**. Users who need binary blobs or arbitrary-precision integers:
- Encode them as a supported type (e.g., binary → base64 string; bigint → string).
- Go through `raw` for adapter-specific handling.

These are not deferred — they are not part of the framework's value-type model.

#### Adapter declaration

```ts
const PostgresAdapter = defineAdapter((a) => a
  .config({} as PgCfg)
  .queryableOps(...)
  .updateOps(...)
  .supportedValueTypes('string', 'number', 'boolean', 'null', 'object', 'array', 'date')
  .lifecycle({ connect, disconnect })
  .crud({ ... })
  .queryable({ ... })
  .transactional({ session })
)

const SqliteAdapter = defineAdapter((a) => a
  .config({} as SqliteCfg)
  .queryableOps(...)
  .updateOps('set')
  .supportedValueTypes('string', 'number', 'boolean', 'null')   // honest: no native objects/arrays/dates
  .lifecycle({ connect, disconnect })
  .crud({ ... })
  .queryable({ ... })
)

const FirebaseAdapter = defineAdapter((a) => a
  .config({} as FirebaseCfg)
  .queryableOps(...)
  .updateOps('set')
  .supportedValueTypes('string', 'number', 'boolean', 'null', 'object', 'array', 'date')   // Firestore native types
  .crud({ ... })
  .queryable({ ... })
)
```

If `.supportedValueTypes(...)` is omitted, default to **`readonly []`** — adapter supports zero value types. Pairing such an adapter with any schema produces a TS error at every Repo method call (since every schema has at least a PK field, which has some kind). Forces adapter authors to declare honestly; matches the locked Q4 rule for `queryableOps` / `updateOps` (omission = empty list).

#### TS-level narrowing

Framework derives a "value kind" per schema field by inspecting the pipe's output type:

```ts
type ValueKindOf<P extends Pipe<any, any>> =
  [PipeOutput<P>] extends [string]                ? 'string'  :
  [PipeOutput<P>] extends [number]                ? 'number'  :
  [PipeOutput<P>] extends [boolean]               ? 'boolean' :
  [PipeOutput<P>] extends [null]                  ? 'null'    :
  [PipeOutput<P>] extends [Date]                  ? 'date'    :
  [PipeOutput<P>] extends [readonly unknown[]]    ? 'array'   :
  [PipeOutput<P>] extends [object]                ? 'object'  :
  never

type SchemaValueKinds<S extends AnySchema> = {
  [K in keyof SchemaFields<S>]: ValueKindOf<SchemaFields<S>[K]['pipe']>
}[keyof SchemaFields<S>]

type SchemaCompatible<A, S extends AnySchema> =
  SchemaValueKinds<S> extends A['supportedValueTypes'][number] ? S : never
```

Repo methods constrain the schema arg:

```ts
findMany<S extends AnySchema>(
  schema: SchemaCompatible<A, S>,
  q: WhereFactory,
  opts?: QueryOptions,
): Promise<SchemaOutput<S>[]>
// ↑ schema typed `never` when adapter can't persist some field type → TS error at the call site
```

Pairing `SqliteAdapter` with a schema containing `v.object(...)`:

```ts
const repo = defineRepo((r) => r.adapter(SqliteAdapter).resolve(...))
await repo.findMany(SchemaWithObject, q)
//                  ^^^^^^^^^^^^^^^^
// TS error: argument of type 'SchemaWithObject' is not assignable to parameter of type 'never'
// (one of its fields uses an output type SqliteAdapter cannot persist)
```

Same UX as misdeclaring an op against `queryableOps` / `updateOps` — compile-time refusal.

#### Trade-offs accepted

1. **TS-level pipe-output analysis is brittle for non-trivial pipes.** A pipe whose output is `Map<K, V>` matches the `[object]` branch (close enough); a pipe producing `Promise<X>` or other anomalous output resolves to `never`, which makes `SchemaValueKinds<S>` include `never`, which is vacuously compatible. Documentation note: pipe authors should ensure their pipe output types map cleanly to a canonical kind.
2. **Default-to-empty when omitted.** Adapters that don't declare are incompatible with every schema (since every schema has at least one field). Forces honest declaration. Matches Q4's omission-equals-empty rule for `queryableOps` / `updateOps`.
3. **One-level kind check.** `v.object({ foo: v.array(...) })` is tagged `'object'`; framework doesn't recursively validate nested types against the adapter. If the adapter supports `'object'`, nested arbitrary structure is the adapter's problem (Mongo handles via BSON; PG via JSONB; SQLite via JSON.stringify).
4. **No silent serialization fallback in the framework.** If SQLite doesn't declare `'object'`, the framework refuses to compile a schema with `v.object()` against it. The adapter never sees an unsupported value.

#### Cross-cutting consistency with locked principles

- **Closed canonical set** matches filter-ops / update-ops design.
- **Per-adapter subsetting** matches per-op declaration philosophy (Q4 revision).
- **Compile-time over runtime** matches "type system is the contract" cross-cutting principle.
- **No silent emulation** — adapter has to honestly declare what it can store.

### Q12 — Upsert placement (LOCKED)

**Decision: query-based `upsertOne(schema, q, insert, ...ops)`.** No PK-keyed variant. PK-based upsert expressed as `q.eq(schema.pkField, pk)` if needed.

#### Why query-based, not PK-keyed

`upsertByPk` doesn't match real-world app patterns. Real upsert is "find-or-create by natural key" — email, slug, FK, hash — where the lookup field isn't the PK. PK-keyed variant rejected.

#### API shape

```ts
await repo.upsertOne(UserSchema,
  q => q.eq(UserSchema.fields.email, 'a@b.com'),     // matching filter
  { name: 'Alice', email: 'a@b.com' },                // full insert payload (typed SchemaInput<S>)
  set({ lastSeen: Date.now() }),                      // ops applied if existing
  inc(UserSchema.fields.loginCount, 1),
)
```

Returns the row (created or updated). Atomic per the adapter's native semantics.

#### Capability gating

`'upsert'` joins the `updateOps` canonical literal list:

```ts
updateOps:    'set' | 'inc' | 'mul' | 'min' | 'max' | 'unset' | 'push' | 'pull' | 'patch' | 'upsert'
```

Repo `upsertOne` exists when:
- `'upsert' in A['updateOps']`, AND
- `A['queryableOps']` is non-empty (since upsert takes a filter).

If either is missing, `repo.upsertOne` is `never`.

#### Adapter contract

Lives in `queryable` bag (alongside `findMany`/`updateMany`/`deleteMany`) since it takes a `QueryGroup`:

```ts
interface AdapterQueryable<C> {
  findMany?(...)
  updateMany?(...)
  deleteMany?(...)
  upsertOne?(
    schema: AnySchema,
    q: QueryGroup,
    insert: Record<string, unknown>,
    ops: UpdateOp[],
    cfg: C,
  ): Promise<Record<string, unknown>>
}
```

#### Adapter implementability — store-by-store

| Adapter | Implementation | Filter constraint |
|---|---|---|
| **MongoDB** | `findOneAndUpdate(filter, {$setOnInsert: insert, $set:..., $inc:...}, {upsert: true})` | Any filter — native support |
| **PostgreSQL** | `INSERT ... ON CONFLICT (col) DO UPDATE SET ...` — adapter inspects filter for single `eq` on a UNIQUE-indexed column → uses as `ON CONFLICT` target | Single `eq` on unique-indexed column |
| **SQLite** | Same as PG | Single `eq` on unique-indexed column |
| **Firebase** | `setDoc(ref, {...}, { merge: true })` — adapter inspects filter for `eq` on PK; otherwise refuses | Single `eq` on PK |

**Adapter-side runtime check:** if filter shape isn't natively supported, throw clear `EquippedError`:

```ts
upsertOne(schema, q, insert, ops, cfg) {
  const eq = extractSingleEq(q)
  if (!eq || !isUniqueIndexed(schema, eq.field)) {
    throw new EquippedError(
      `PG upsert requires filter to be a single eq on a UNIQUE-indexed column; got: ${describe(q)}`,
      { schema: schema.name, filter: q }
    )
  }
  // ... ON CONFLICT (eq.field) DO UPDATE SET ...
}
```

Documented per-adapter in their README. Matches "honest adapters fail loudly" principle.

#### Insert-path semantics

- **Row exists**: ignore `insert` payload; apply ops to existing row. Standard update semantics. Q7.α onUpdate auto-bump applies (any field touched by ops suppresses its `onUpdate` generator; untouched fields with `onUpdate` get implicit `set` ops).
- **Row missing**: insert `insert` payload (validated via pipes per `insertOne` rules; `onCreate` defaults applied for missing fields), then apply ops on top.
  - SetOp values override the inserted fields.
  - Atomic ops apply to the inserted values (e.g., `inc(views, 1)` on insert with `views: 0` → `views: 1`).

Matches Mongo's `$setOnInsert` + ops-merge model and PG's `EXCLUDED.col` + ops semantics.

#### Validation (Q7-consistent)

- `insert` payload: `validateInsert(schema, insert)` — full row validated, `onCreate` defaults injected.
- Filter: `assertNormalisedFilter(schema, q)` — A + B + F from Q5.2 (existence, op closure, logical names).
- Ops: same Q5.1 rules — `SetOp` values pipe-validated; atomic op operands not validated.
- Conflict-rejection (Q5.x) applies: same field touched by both `insert` payload values and a conflicting op → throws.
- All errors collected (Q7 collect-all) → single `OrmValidationError` if any failures.

#### Bulk upsert out of scope

`upsertMany(schema, q, ...)` for bulk upsert is **not supported**. Single-row upsert only. Users who need bulk find-or-create semantics use `raw` for the adapter-specific implementation (Mongo `bulkWrite`, PG `INSERT ... VALUES (...), (...) ON CONFLICT ...`).

### Q5.x — Q5.1 sub-decisions (LOCKED)

- **Reject conflicting ops on the same field at the package layer.** `repo.updateMany(filter, set({views: 0}), inc(views, 1))` throws at the boundary with "conflicting ops on field views". Walk the op list collecting `{op.kind, op.field}` pairs; any field touched twice is a conflict. Includes cross-kind conflicts (e.g. `unset(x) + push(x)`). Reason: order-dependent semantics across adapters (Mongo / PG / Firebase apply set+inc in different orders) is exactly the silent inconsistency we banned. Conflicts are almost always bugs; loud failure beats a wrong number in prod. Users who genuinely want sequential semantics use two calls inside `session()`.
- **Require ≥1 op in `update*` call signatures (compile error).** Signature: `update*(filter, op0: UpdateOp<S, A>, ...rest: UpdateOp<S, A>[])`. An update with no ops is meaningless — TS catches it at the call site. Same family as the builder-time empty `and([])` / `or([])` rejection.

### Branches — all resolved

All architectural branches locked. No deferred decisions remain. Cross-reference index:

1. `AdapterStorage` surface → Q5.5 (CRUD-by-PK quartet + lifecycle split + all-bags-optional) + Q12 (upsert placement).
1b. Schema field-type ↔ adapter capability → Q11 (`supportedValueTypes`, 7-tag closed canonical set).
2. Schema portability for adapter-specific config → Q6 (`defineRepo(.resolve(...))` + per-query `ContextSource.get()`).
3. Validation flow → Q7 (Repo-entry boundary; collect-all; `OrmValidationError`).
4. Transactions / `session` → Q8 (callback shape; throw-to-rollback; adapter-internal ALS; nested delegated to adapter; isolation deferred to DB default).
5. Relations declaration → Q9 (separate from schema; builder-chain factory `defineRelations((rel, src) => ...)`; `Field<T,N,S>` phantom; explicit join schemas; composite FK/PK out of scope).
6. Repo construction surface → Q6 (single-Repo D; `defineRepo((r) => r.adapter(...).resolve(...).context(ctxSource))`; library imports zero `node:async_hooks`).
7. Naming drift → Q10 (positives short / negatives `notX`; `notExists` own enum value; `QueryGroup.raw` dropped; README reconciliation).

---

## Architectural reference (current locked state)

### Capabilities (inferred structurally — no `capabilities` array)

| Capability | Inferred from | Op list |
|---|---|---|
| Lifecycle | optional `lifecycle` bag | — |
| CRUD (PK-keyed + raw) | optional `crud` bag — methods independently optional | — |
| Queryable (filter-based) | optional `queryable` bag (requires non-empty `queryableOps`) | `'eq'\|'ne'\|'gt'\|'gte'\|'lt'\|'lte'\|'in'\|'notIn'\|'like'\|'exists'\|'notExists'\|'contains'\|'notContains'` |
| Updatable | non-empty `updateOps` (governs ops in `updateByPk` / `updateMany`; `'upsert'` gates `upsertOne`) | `'set'\|'inc'\|'mul'\|'min'\|'max'\|'unset'\|'push'\|'pull'\|'patch'\|'upsert'` |
| Value-type compatibility | non-empty `supportedValueTypes` (gates schema arg) | `'string'\|'number'\|'boolean'\|'null'\|'object'\|'array'\|'date'` |
| Transactional | optional `transactional` bag | — |

All bags optional. No required adapter fields except `config` (type marker). Op-list fields default to `readonly []` when omitted (omission = empty list).

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
  upsertOne?  (schema: AnySchema, q: QueryGroup, insert: Record<string, unknown>, ops: UpdateOp[], cfg: C): Promise<Record<string, unknown>>
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

### Adapter factory shape (builder-chain — locked Q9 upgrade)

```ts
const PostgresAdapter = defineAdapter((a) => a
  .config({} as PgCfg)
  .queryableOps('eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'like', 'exists', 'notExists', 'contains', 'notContains')
  .updateOps('set', 'inc', 'mul', 'min', 'max', 'unset', 'push', 'pull', 'patch', 'upsert')
  .supportedValueTypes('string', 'number', 'boolean', 'null', 'object', 'array', 'date')
  .lifecycle({ connect, disconnect })
  .crud({ findByPk, insertMany, updateByPk, deleteByPk, raw })
  .queryable({ findMany, updateMany, deleteMany, upsertOne })
  .transactional({ session })
)

const FirebaseAdapter = defineAdapter((a) => a
  .config({} as FirebaseCfg)
  .queryableOps('eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn')        // honest: no like/contains server-side
  .updateOps('set', 'upsert')                                                // atomic FieldValue.* via raw; setDoc(merge:true) handles upsert
  .supportedValueTypes('string', 'number', 'boolean', 'null', 'object', 'array', 'date')
  // no .lifecycle — Firestore lazy-connects
  .crud({ findByPk, insertMany, updateByPk, deleteByPk, raw })
  .queryable({ findMany, updateMany, deleteMany, upsertOne })
)

const SqliteAdapter = defineAdapter((a) => a
  .config({} as SqliteCfg)
  .queryableOps('eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'like')
  .updateOps('set', 'upsert')
  .supportedValueTypes('string', 'number', 'boolean', 'null')                // honest: no native objects/arrays/dates
  .lifecycle({ connect, disconnect })
  .crud({ findByPk, insertMany, updateByPk, deleteByPk, raw })
  .queryable({ findMany, updateMany, deleteMany, upsertOne })
)

const KVOnlyAdapter = defineAdapter((a) => a
  .config({} as KVCfg)
  .updateOps('set')
  .supportedValueTypes('string', 'number', 'boolean', 'null', 'object', 'array')
  .lifecycle({ connect, disconnect })
  .crud({ findByPk, insertMany, updateByPk, deleteByPk, raw })
  // no .queryable → pure key-value, no upsert (which is filter-based)
)

const ReadOnlyWarehouseAdapter = defineAdapter((a) => a
  .config({} as WHCfg)
  .queryableOps('eq', 'gt', 'gte', 'lt', 'lte', 'in')
  .supportedValueTypes('string', 'number', 'boolean', 'null', 'date')
  .lifecycle({ connect, disconnect })
  .crud({ findByPk, raw })            // read + escape hatch only
  .queryable({ findMany })            // read-only filter
)
```

The builder enforces (per-step type checks):
- `.queryable({...})` resolves to `never` if `.queryableOps(...)` was not called with a non-empty list — TS error at the offending line.
- `upsertOne` in `queryable` bag resolves to `never` if `'upsert'` is not in `.updateOps(...)`.
- Each method (`.config`, `.queryableOps`, `.updateOps`, `.supportedValueTypes`, `.lifecycle`, `.crud`, `.queryable`, `.transactional`) callable at most once. Second call is a TS error via the never-trick.
- Op rest-args (`'eq', 'ne', ...`, `'string', 'number', ...`) drawn from closed canonical sets; unknown values are TS errors.
- Methods not called default to absent → corresponding capability not declared → Repo surface narrows.
- Pairing the adapter with a schema whose field types aren't all in `.supportedValueTypes(...)` is a TS error at the schema arg of every Repo method (Q11).

### Repo type narrowing (single-Repo, schema-per-call)

Every schema-arg position is wrapped in `SchemaCompatible<A, S>` (Q11) so pairing an incompatible schema is a TS error.

```ts
type RepoSurface<A> =
  & {
      // Always-on storage surface (schema-per-call)
      findByPk  <S extends AnySchema>(schema: SchemaCompatible<A, S>, pk: unknown): Promise<SchemaOutput<S> | null>
      insertOne <S extends AnySchema>(schema: SchemaCompatible<A, S>, row: SchemaInput<S>): Promise<SchemaOutput<S>>
      insertMany<S extends AnySchema>(schema: SchemaCompatible<A, S>, rows: SchemaInput<S>[]): Promise<SchemaOutput<S>[]>
      deleteByPk<S extends AnySchema>(schema: SchemaCompatible<A, S>, pk: unknown): Promise<boolean>
      raw: A['raw']
      // updateByPk types to never if updateOps is empty
      updateByPk: A['updateOps']['length'] extends 0
        ? never
        : <S extends AnySchema>(schema: SchemaCompatible<A, S>, pk: unknown, op0: UpdateOp<S, A>, ...rest: UpdateOp<S, A>[]) => Promise<SchemaOutput<S> | null>
    }
  & (A['queryableOps']['length'] extends 0
      ? {}
      : {
          findOne  <S extends AnySchema>(schema: SchemaCompatible<A, S>, q: WhereFactory): Promise<SchemaOutput<S> | null>
          findMany <S extends AnySchema>(schema: SchemaCompatible<A, S>, q: WhereFactory, opts?: QueryOptions): Promise<SchemaOutput<S>[]>
          updateOne: A['updateOps']['length'] extends 0
            ? never
            : <S extends AnySchema>(schema: SchemaCompatible<A, S>, q: WhereFactory, op0: UpdateOp<S, A>, ...rest: UpdateOp<S, A>[]) => Promise<SchemaOutput<S> | null>
          updateMany: A['updateOps']['length'] extends 0
            ? never
            : <S extends AnySchema>(schema: SchemaCompatible<A, S>, q: WhereFactory, op0: UpdateOp<S, A>, ...rest: UpdateOp<S, A>[]) => Promise<SchemaOutput<S>[]>
          // upsertOne — gated by 'upsert' in updateOps
          upsertOne: 'upsert' extends A['updateOps'][number]
            ? <S extends AnySchema>(schema: SchemaCompatible<A, S>, q: WhereFactory, insert: SchemaInput<S>, ...ops: UpdateOp<S, A>[]) => Promise<SchemaOutput<S>>
            : never
          deleteOne <S extends AnySchema>(schema: SchemaCompatible<A, S>, q: WhereFactory): Promise<boolean>
          deleteMany<S extends AnySchema>(schema: SchemaCompatible<A, S>, q: WhereFactory): Promise<number>
        })
  & (A extends { transactional: { session: any } }
      ? { session<T>(fn: () => Promise<T>): Promise<T> }
      : {})
```

Repo is parameterised by adapter only (`Repo<A>`, not `Repo<S, A>`). Per-call return types narrow via the `S` generic on each method. Adapter capability narrowing (`updateOps`, `queryableOps`, `transactional`, `supportedValueTypes`) drives method existence and schema compatibility.

`update*` signatures require ≥1 op via `op0` + `...rest` (Q5.x lock — empty op list is a compile error).

### Update operation list (user-facing helpers)

```ts
import { set, inc, mul, min, max, unset, push, pull, patch } from 'equipped/orm'

await repo.updateMany(UserSchema,
  q => q.eq(UserSchema.fields.id, 'u1'),
  set({ name: 'Alice', email: 'a@b.com' }),       // values validated against schema pipes
  inc(UserSchema.fields.views, 1),                 // not validated
  push(UserSchema.fields.tags, 'rust'),            // not validated
  unset(UserSchema.fields.deprecatedField),
)

// PK-keyed — same op list, no filter
await repo.updateByPk(UserSchema, 'u1', set({ name: 'Alice' }), inc(UserSchema.fields.views, 1))

// Upsert (filter-based) — gated by 'upsert' in updateOps
await repo.upsertOne(UserSchema,
  q => q.eq(UserSchema.fields.email, 'a@b.com'),
  { name: 'Alice', email: 'a@b.com' },                  // insert if missing (full SchemaInput)
  set({ lastSeen: Date.now() }),                         // ops if existing
)
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
  // 'upsert' is not an in-line op — it gates the existence of repo.upsertOne (Q12)

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
eq · ne · gt · gte · lt · lte · in · notIn · like · exists · notExists · contains · notContains · and · or
```

Locked Q10: positives stay short (`in`, `exists`, `contains`); negatives use `notX` prefix. Method names and enum values match exactly. `notExists` is its own enum value (not a boolean form of `exists`).

---

## Cross-cutting principles agreed

- **Builder-chain factory** for all API definitions (`defineSchema`, `defineRelations`, `defineAdapter`, `defineRepo`). Direct function calls for invocation/operations (`repo.findByPk`, `repo.session`, op helpers). See Q3.x (revised post-Q9).
- **No silent emulation.** Capabilities are honest; missing means missing. Adapter-specific power lives in `raw` only (extensions out of scope).
- **Type system is the contract.** Capability mismatches are compile errors, not runtime throws, wherever feasible.
- **Capabilities are per-op subsettable.** Adapters declare exactly which ops/types they support via `queryableOps` / `updateOps` / `supportedValueTypes` literal lists. TS narrows the surface accordingly. (Revised from earlier all-or-none rule — see Q4 and Q11.)
- **Validation lives once, in the package**, not duplicated across adapters. The boundary normalisation pass (Q5.2) enforces structural guarantees (field existence, op closure, logical names); filter *value* types are a TypeScript-only contract — no runtime coercion.
- **Always throw, never silently drop.** Empty groups, missing fields, unknown ops fail loudly. No silent short-circuits, no "match-all" or "match-none" fallbacks at boundaries.
- **Migrations / aggregates / streaming are out of scope** for this layer.

---

## Implementation handoff

The redesign tree is fully closed. All architectural decisions are locked (Q1 through Q12 + Q5.x). No deferred items remain. Out-of-scope items (composite FKs/PKs, `'binary'` / `'bigint'` value types, bulk upsert, adapter extensions, migrations, aggregates, streaming, server-side joins) are explicitly *not supported* — users who need them go through `raw`.

Implementation notes:
- The package's existing `src/orm` code reflects the *pre-redesign* shape (class-based `Schema.from(...)`, `Relations.of(...)`, `OrmAdapter` class, `Repo.from({ adapter, resolve })`, `OrmUse` shim, old op names like `nin` / `nexists`).
- A focused implementation pass converts those to the locked redesign: builder-chain factories (`defineSchema`, `defineRelations`, `defineAdapter`, `defineRepo`), retired `OrmUse`, renamed enum values (`notIn` / `notExists` / `notContains`), separate `'notExists'` enum, added `findByPk` / `updateByPk` / `deleteByPk` to Repo + Storage, locked `ContextSource` hook, removed library-side ALS, etc.
- Honour the locked principles: builder-chain for definitions, no silent emulation, per-op subsettable capabilities, filter-value types as TS-only contract (no runtime coercion), always-throw-never-silently-drop, validation lives once in the package, library imports zero `node:async_hooks`.
