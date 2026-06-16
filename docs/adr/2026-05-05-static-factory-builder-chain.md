# Switch artifact construction from `defineX(callback)` to `X.from()...build()`

The four ORM artifact factories (`defineSchema`, `defineRelations`, `defineAdapter`,
`defineRepo`) are replaced with static factory methods on the artifact classes
(`Schema.from`, `Relations.from`, `Adapter.from`, `Repo.from`), each returning a
builder terminated by an explicit `.build()` call. Each `.from(...)` takes only
the constructor-essential input(s) (positional value for Schema/Relations/Repo;
type-only generic for Adapter); everything else flows through builder steps.
This unifies how the four artifacts are constructed, enables the Adapter's
config type to be declared as `Adapter.from<Config>()` (replacing the misnamed
`.config()` step), and makes the Repo's `.resolve` step's return-type
constraint unconditional once `.adapter()` was eliminated by moving the adapter
to a positional arg on `Repo.from(adapter)`.

## Considered Options

- **Adapter-only exception.** Carve `defineAdapter` out of the `defineX(callback)`
  rule but keep the rest. Rejected: introducing a one-off exception in a
  load-bearing pattern is worse than a clean rewrite.
- **Two-call factory.** Keep the callback shape but use `defineAdapter<C>()((b) => ...)`
  to thread the explicit Config generic. Smallest change, but the empty `()`
  is an irreducible wart and the inconsistency between Adapter and the other
  three would persist.
- **Hybrid builder-is-artifact.** Skip the explicit `.build()` and have every
  step return an object that's both a Builder and the Artifact. Rejected: the
  accumulator-conditional surface (`RepoSurface<A>` narrowing) would have to
  combine with builder-step gating, roughly doubling the number of `extends`
  conditions; risk of using a half-built artifact when one condition is
  forgotten.

## Consequences

- ~150 call sites across `src/orm/**` (factory invocations + tests) migrate
  mechanically. Out-of-tree adapter authors must migrate too.
- Major version bump.
- CONTEXT.md §1.5 reverses (it previously prohibited `Schema.from(...)` by name);
  §2 vocabulary rewritten (factory = static method; build callback removed;
  terminal step = `.build()`); §9.3 source-bound build callback removed;
  cross-cutting principle #1 restated.
- The `repo.from(schema)` instance method is renamed to `repo.on(schema)` to
  resolve the static/instance `from` collision with the new `Repo.from(adapter)`.
