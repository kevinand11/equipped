# Adapter is a class built via `configurable`, not a builder

The orm `Adapter` artifact is converted from a builder (`Adapter.from<Config>().crud({...}).queryable({...}).build()`) to a class hierarchy
(`class MongoAdapter extends configurable(connectionPipe, OrmAdapter) {...}`),
unifying it with the existing `configurable` pattern used by cache/jobs/events
adapters and (after this change) by the server adapters too. The
`configurable(pipe, Base)` primitive validates a connection-level config pipe
at construction (via inherited `static create(input, ...args)` and a
`protected constructor`), exposing the validated config as `this.config` and
as a phantom `static Config` type marker. The orm-side `OrmAdapter` abstract
base flattens the four bag groupings (`lifecycle`, `crud`, `queryable`,
`transactional`) into twelve optional methods, declares three capability
arrays as instance fields with literal-typed `as const` overrides, and
requires a `readonly schemaConfigPipe` for per-call validation of the
resolver's output — collapsing the prior `<SchemaCfg>` generic into a
pipe-derived type. This answers TODO #12 (adapter config validation) and
makes `configurable` the single configuration-validation primitive across
the package. The same landing also reworks `Instance.on(...)` from numeric
ordering to a class-keyed DAG (named hooks with `after: ClassRef[]`
dependencies, automatically inverted for the `close` event), and `OrmAdapter`'s
constructor auto-registers `connect` / `disconnect` / `onFatalError`
against `Instance` based on method presence — closing TODO "Instance
lifecycle integration."

## Considered Options

- **Keep the orm `Adapter.from<Config>()` builder; add a `.configPipe(pipe)` step.**
  Smallest change, no consolidation. Rejected: leaves two construction
  patterns (class-based `configurable` for cache/jobs/events, builder-based
  `Adapter.from` for orm) for what is morally the same operation, and
  duplicates the validation primitive across both.
- **Mixin via nested anonymous class** (`extends configurable(pipe, class extends Cache {...})`).
  The status quo. Rejected: doubly-nested class is the wart driving the
  refactor; the two `@ts-expect-error` markers in `configurable.ts` reflect
  the typing friction.
- **Decorator (TS 5 stage-3) `@configurable(pipe) class X extends Cache {...}`.**
  Cleanest authoring, but stage-3 decorators cannot transform constructor
  parameter types — `static create`'s input typing would regress to `unknown`
  or require redundant manual typing.
- **Smart constructor with branded validated type.** Constructor accepts
  `Validated<P>`; call site is two-step (`new RedisCache(validate(pipe, raw), extras)`).
  Rejected: the call-site verbosity propagates to every consumer.
- **Lifecycle hook (`onInit(extras)`) — leaf has no constructor.**
  Eliminates the `config` parameter from the leaf entirely. Rejected: calling
  subclass methods from a base constructor runs before subclass field
  initializers, a known anti-pattern footgun.
- **Bags survive as nested objects on the class** (`class MongoAdapter { crud = { findByPk: ... } }`).
  Rejected: loses class-method ergonomics (this-binding, private fields,
  IDE navigation) for no narrowing benefit — the co-required-pair check that
  bags structurally enforced now self-polices via type narrowing on empty
  `queryableOps`.
- **Drop pipe validation for per-query schema config.** Validate only the
  one-shot connection config; trust the resolver's output. Rejected:
  inconsistent with the project's "every layer boundary gets a pipe"
  coding rule, and silently masks resolver/transform bugs that today crash
  inside adapter internals with unhelpful stack traces.
- **Auto-wire `Instance` hooks inside `configurable` itself.** Move the
  lifecycle registration into the package-level wrapper so cache/events/jobs
  adapters also benefit. Rejected: lifecycle is conceptually orthogonal to
  config validation; coupling them in `configurable` would conflate two
  concerns. Auto-wiring lives in `OrmAdapter`'s constructor only;
  cache/events/jobs adapters keep their per-class `Instance.on(...)` calls
  (now using the new class-keyed signature).
- **Keep numeric ordering for `Instance.on(...)`.** Rejected: numeric
  orders are an ordinal expression of what is fundamentally a partial-order
  problem, and they force every hook author to know the global dependency
  graph (e.g. "DbChange depends on Kafka, so its order has to be > Kafka's
  order — but what's Kafka's order?"). Replaced with class-keyed DAG.
- **Allow string names for hook dependencies in `after: [...]`.** Rejected:
  string names reintroduce the typo footgun and aren't IDE-refactor-safe.
  `after:` accepts class refs only; freestanding hooks that need to be
  depended on must own a class identity.

## Consequences

- `src/orm/adapter.ts` (~330 LOC of `AdapterBuilder` accumulator gymnastics)
  is deleted; replaced by an `OrmAdapter` abstract base with twelve flat
  optional methods, three capability declarations, and `schemaConfigPipe`.
- `src/utilities/configurable.ts` is rewritten: the wrapper takes
  `Base extends new (...args: any[]) => any` (forwarding base args via
  `super(...baseArgs)`), produces a class with `protected constructor`,
  inherited `static create` using `ConstructorParameters<This>` to slice
  the validated-config arg, and a `declare static readonly Config` phantom
  marker for typing leaf constructor parameters. Full vocabulary and rules
  in the new `docs/utilities/CONTEXT.md`.
- `configurableFn` is deleted. `ExpressServer` and `FastifyServer` become
  `class extends configurable(serverConfigPipe, Server)`; the existing
  `Server` interface is lifted to an abstract class.
- All adapter classes (cache, jobs, events, server, future orm) migrate from
  `extends configurable(pipe, class extends Base {...})` to flat
  `extends configurable(pipe, Base)` with leaf bodies inlined; constructors
  become `protected`; bypass via `new` is now a compile error.
- Per-query dispatch in the orm validates the resolver's effective config
  against `adapter.schemaConfigPipe` before calling the adapter method —
  microsecond overhead per query for small configs, accepted without
  pre-built caching.
- CONTEXT.md §1.3 (Adapter), §2 (builder-chain rule scope), §3.1
  (behaviours/bags), §3.3 (co-required pair — deleted), §3.4–§3.5 (surface
  narrowing reads off class structure), §6 (two-tier config split) all
  rewritten. Builder-chain rule §2.2 is amended to apply only to declarative-
  data artifacts (Schema, Relations); behavioural artifacts (Adapter) use
  the class-via-`configurable` form.
- TODO.md item 12 (adapter config validation pipe) is closed; pointer added
  to this ADR.
- TODO.md item "Typed driver escape hatch" is closed by structural
  consequence: with Adapter as a class, the underlying driver instance is a
  normal `readonly` field on the adapter (e.g. `mongoAdapter.client: MongoClient`),
  reachable directly by consumers without a framework `extras` slot. Adapter
  authors decide which fields to expose; the framework neither requires nor
  forbids it.
- `src/orm/schema.ts` refactored to extract a separate `SchemaBuilder<...>`
  class (mirroring `RelationsBuilder` and `RepoBuilder`); `Schema.from(name)`
  returns `SchemaBuilder<N>`, and `.build()` on the builder constructs the
  actual `Schema`. The user-facing chain (`Schema.from(name).pk(...).field(...).build()`)
  is unchanged; the change is internal — eliminating the inconsistency where
  Schema's chain methods lived on `Schema` itself and `.build()` was
  `return this` ceremony, while Relations/Repo used separate Builder
  classes. Bundled into this landing because it's mechanical and keeps the
  three remaining declarative-data artifacts type-shape-uniform.
- All builders converted from in-place mutation (`return this as any`) to
  clone-on-step (each step returns a new builder instance with the updated
  state). Affects `SchemaBuilder` (new), `RelationsBuilder`, `RepoBuilder`,
  and the filter sub-builder `FilterGroup` / `QueryGroup`. The per-call
  query builders (`OneBuilder`, `AllBuilder`) are already clone-based — no
  change. Codified as the **clone-on-step rule** in CONTEXT.md §2.2.
  Motivation: package users can hold a partially-built builder and fan out
  from it (`const base = X.from(...).step1(); const a = base.step2(...); const b = base.step3(...)`)
  without divergent chains polluting each other or the shared base. The
  cost is one allocation per step, negligible at module load and in the
  microsecond range per query for filter chains.
- `Instance.on(event, cb, order: number)` is replaced with
  `Instance.on(event, cb, options?: { class?: ClassRef; after?: ClassRef[] })`.
  Numeric orders go away. Hooks form a class-keyed DAG; the runtime
  topo-sorts and runs same-depth siblings in parallel; `close`-event
  graphs invert automatically. Cycle detection and missing-dependency
  detection happen at registration time. `OrmAdapter`'s constructor
  auto-registers `connect` / `disconnect` keyed by `this.constructor`;
  cache/events/jobs adapters keep their per-class registrations but
  migrate from numeric `order` to `{ class: ThisClass }`. Full vocabulary
  and rules in the new `docs/instance/CONTEXT.md`. TODO.md item "Instance
  lifecycle integration" is closed by this rework.
- Major version bump. Out-of-tree adapter authors migrate from
  `Adapter.from<Config>()...build()` to `class extends configurable(pipe, OrmAdapter)`,
  and any code calling `Instance.on(...)` migrates from numeric `order` to
  `{ class, after }` options.
