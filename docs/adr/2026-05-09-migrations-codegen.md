# Migration codegen — adapter-introspection diff with name-based matching

The migrations subsystem ships first-party codegen ("B" in the C-hybrid
scope, alongside the runtime "A" decided in
`2026-05-09-migrations-runtime.md`). A new `MigrationCodegen` artifact
takes a Repo plus an explicit set of target Schemas and produces a
`ReadonlyArray<ChangeFor<A>> | null` (the `null` when the live DB already
matches target). Codegen requires the adapter to declare
`introspect?(): Promise<DiscoveredSchema[]>` — absence of `introspect` is
a compile error at `MigrationCodegen.from(repo)` via type-level narrowing
(symmetric with `SchemaCompatible<A, S>` in §5.3). The full v1 spec
extends `docs/orm/CONTEXT.md` §16.

The diff algorithm is **name-based only** — renames surface as
`dropField` + `addField` pairs that the user post-edits to use
`renameField`/`renameTable` if intended. Heuristic rename detection
(name+type matching) was rejected because false positives are catastrophic
(e.g. replacing `firstName` with `lastName` would silently misread as a
rename). Codegen returns raw `Change[]`, not a wrapped `Migration<A>` —
the user supplies the `id` themselves to keep id-conventions out of the
library.

## Considered Options

- **(1) Diff function only, no introspection.** Rejected: incomplete.
  Without an introspection capability the user has to introspect the DB
  themselves and feed `current` into a pure `diff()` — defeats the
  purpose. Skipped.
- **(3) Diff + introspection + file emission
  (`codegen.writeNext('./migrations')`).** Rejected: filesystem coupling
  conflicts with the programmatic-only stance from
  `2026-05-09-migrations-runtime.md` (Q2). Edge runtimes (Workers, Deno)
  can't `fs.writeFile`. Filename conventions are also user-domain
  (timestamp vs counter vs slug). User serializes the returned
  `Migration<A>` themselves in 4 lines.
- **(β) Per-adapter `DiscoveredSchema` types
  (`SqlDiscoveredSchema`, `MongoDiscoveredSchema`).** Rejected: doubles
  the type surface for marginal precision. SQL and Mongo both have
  indexes; the index shape is identical. Single shared type with
  fields/FKs/pk arrays empty for Mongo is honest about Mongo's
  schemaless nature.
- **(γ) Reuse the `Schema` artifact for introspection results.**
  Rejected: pipes carry validation semantics that introspection can't
  recover; computed fields don't exist in DBs; `onCreate`/`onUpdate`
  generators have no DB representation. Reusing Schema for introspection
  forces all those to be optional/lying — a §13 #4 type-system-is-the-contract
  violation.
- **(II) Name+type heuristic rename detection.** Rejected: false
  positives are catastrophic. Replacing `firstName: string` with
  `lastName: string` reads as a rename, silently corrupting data.
- **(III) Content-addressed matching with `@map`-style hints.**
  Rejected for v1: requires extending the `Schema` artifact with rename
  metadata; out of scope.
- **(IV) Interactive prompt for renames.** Rejected: violates
  programmatic-only.
- **(Y) Topological-sort emission order.** Rejected for v1: fixed
  canonical order (drops → renames → creates → adds) covers ~99% of
  cases. Topological sort is implementable later if edge cases (self-
  referencing FKs, circular dependencies) surface in practice.
- **(Q) Skip-and-warn on unrecognized DB types during introspection.**
  Rejected: §13 #6 always-throw-never-silently-drop. Silent skip means
  the diff sees a partial picture and emits Changes that won't apply.
  `OrmIntrospectionError` thrown at introspect time forces the author
  to address the unsupported type immediately.
- **(β) Codegen returns `Migration<A>` with auto-id (timestamp).**
  Rejected: id conventions are user-specific (timestamp vs counter vs
  slug). Picking a default invites either acceptance or override-at-
  every-call — friction either way. Codegen returns raw `Change[]` only;
  user supplies `id` explicitly. Symmetric with the
  no-file-emission decision (filename conventions are also user-domain).
- **(δ) Pluggable id generator on the codegen builder.** Rejected for
  v1: extra builder step for marginal benefit; user wraps the returned
  `Change[]` themselves anyway.
- **(β) Runtime gate** (compile fine, throw `OrmIntrospectionError` if
  `adapter.introspect` is undefined). Rejected: capability mismatches
  should be compile errors whenever feasible (§13 #4). Same pattern as
  `SchemaCompatible<A, S>` and Repo-verb narrowing.

## Consequences

- New artifact `MigrationCodegen` in `src/orm/migrations/` joins
  `Migrator` from the runtime ADR. Builder-chain shape per §2.2.
- New optional adapter capability `introspect?():
  Promise<DiscoveredSchema[]>`. In-tree adapters: PostgreSQL implements
  via `information_schema.columns` + `pg_indexes` +
  `information_schema.table_constraints`; SQLite via `PRAGMA
  table_info(...)` etc.; MongoDB via `db.listCollections()` +
  per-collection `listIndexes()`; in-memory walks the internal Map
  state.
- New error class `OrmIntrospectionError extends EquippedError`,
  sibling of `OrmValidationError` / `OrmNotFoundError` /
  `OrmReplayError` / `OrmMigrationError` under `src/orm/errors/`.
- v1 codegen does **not** auto-derive foreign keys from the `Relations`
  artifact (§9). Relations live separately from Schemas; v1 ignores
  them. User adds `addForeignKey` / `dropForeignKey` Changes manually
  when their Relations change. Future enhancement: walk Relations
  alongside Schemas.
- v1 codegen emits the §16.2 LCD subset only — long-tail features
  (CHECK constraints, partial indexes, functional indexes, GIN/GIST,
  TTL) stay in `execute` escape territory.
- v1 codegen has no rename detection. Renames surface as
  `dropField` + `addField` pairs; user post-edits the generated
  `Change[]` to use `renameField`/`renameTable`.
- v1 codegen has no drift detection beyond what the diff naturally
  exposes. Running `codegen.diff()` against a drifted DB returns
  Changes that reconcile current → target; the user reviews them and
  accepts/rejects.
- §14 out-of-scope row 17 (which previously said "Migration codegen
  deferred") is updated: codegen ships in v1 with the listed
  limitations.
