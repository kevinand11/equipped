# Single per-schema entry: collapse Repo CRUD methods into `repo.on(Schema)` chain

All per-schema CRUD methods previously exposed directly on the Repo
(`repo.findByPk`, `findOne`, `findMany`, `createOne`, `createMany`,
`updateByPk`, `updateOne`, `updateMany`, `deleteByPk`, `deleteOne`,
`deleteMany`, `upsertOne`, `raw`) are removed. The schema-bound chain
`repo.on(Schema).{one,all}()...{find,create,update,delete,upsert,raw}()`
becomes the sole entry point for every per-schema operation. Only `session`,
`resolve`, and `on` survive as instance methods on Repo. This eliminates the
duplicate surfaces (`repo.findByPk(s, pk)` vs `repo.on(s).one().id(pk).find()`
both existed and called identical executors) and makes the gating model
uniform: every CRUD operation enters the same way.

## Considered Options

- **Keep both surfaces.** Rejected: API duplication invites cargo-culting and
  doubles the type-machinery surface area (`RepoSurface<A>` had to gate every
  method individually; the chain builders had to gate every verb individually
  for the same set of declarations).
- **Generalise from raw only** (the Q14 single-entry decision). Rejected as
  insufficient: `raw`'s asymmetry between PG (cross-table SQL) and Mongo
  (collection-bound aggregation) made it a special case, but the same
  duplication-without-payoff applies to every CRUD verb.

## Consequences

- The `RepoSurface<A>` narrowing intersection (previously gating
  `updateOne`/`updateMany`/`deleteOne`/`deleteMany`/`upsertOne`/`raw`/`session`
  to `never` based on adapter declarations) collapses — only `session` is
  still narrowed at the Repo type level. Per-verb narrowing moves into the
  chain builders (`OneBuilder`, `AllBuilder`, `SchemaRef`).
- Runtime defensive guards (`if (!adapter.crud?.findByPk) throw …` etc.) at
  the Repo-method entry points become unreachable and are deleted; the
  type-level chain-verb gating catches the same case at compile time.
- Tests using `repo.findByPk(s, pk)` etc. migrate mechanically to
  `repo.on(s).one().id(pk).find()`.
- Major version bump (combined with the broader redesign).
