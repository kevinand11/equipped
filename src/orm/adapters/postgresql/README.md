# PostgreSQL Adapter

In-tree PostgreSQL adapter using the `class-via-configurable` pattern, extending `OrmAdapter`.

## Usage

```ts
import { PostgresAdapter } from 'equipped/orm/adapters/postgresql'
import { Repo } from 'equipped/orm'

const adapter = PostgresAdapter.create({
  host: 'localhost',
  port: 5432,
  username: 'admin',
  password: 'secret',
  database: 'myapp',
})

const repo = Repo.from(adapter)
  .resolve((schema) => ({ table: schema.name }))
  .build()
```

SSL connections are enabled by passing `true` as the second argument to `create`:

```ts
const adapter = PostgresAdapter.create({ host, port, username, password, database }, true)
```

## Typed driver escape hatch

The underlying `pg.Pool` is exposed as a `readonly` instance field for consumers who need direct driver access:

```ts
const result = await adapter.pool.query('SELECT NOW()')
```

## Capabilities

| Category | Declared |
|----------|----------|
| `supportedFieldTypes` | `string`, `number`, `boolean`, `null`, `object`, `array`, `date` |
| `queryableOps` | all 13 canonical ops |
| `updateOps` | `set`, `inc`, `mul`, `min`, `max`, `unset`, `push`, `pull`, `patch` |
| `schemaConfigPipe` | `{ schema?: string, table: string }` |

## Session nesting behaviour

`session(fn)` acquires a `PoolClient`, runs `BEGIN`, executes `fn`, then `COMMIT` on success or `ROLLBACK` on throw. Nested sessions (calling `session` inside another `session`) are flat: the inner call detects an active client via `AsyncLocalStorage` and executes `fn()` directly without starting a new transaction or savepoint. A throw in the inner callback propagates up and rolls back the entire outer transaction.

## Upsert-compatible filter shapes

PostgreSQL upsert uses `INSERT ... ON CONFLICT (col) DO UPDATE SET ...`, which requires a single column with a UNIQUE constraint as the conflict target.

The adapter enforces this at the filter level: the filter passed to `upsertOne` must be a **single `eq` filter on one field** (the UNIQUE-indexed column). Any other filter shape throws `OrmValidationError { kind: 'upsert-filter-incompatible' }` with a message describing the received filter shape.

Valid:
```ts
repo.on(Schema).one().where((q) => q.eq('email', 'a@b.com')).upsert({ create })
```

Invalid (throws):
```ts
repo.on(Schema).one().where((q) => q.eq('a', 1).eq('b', 2)).upsert({ create })  // multiple filters
repo.on(Schema).one().where((q) => q.gt('age', 10)).upsert({ create })            // non-eq filter
repo.on(Schema).one().upsert({ create })                                           // empty filter
```

The adapter does not validate that the filter field has a UNIQUE index — that responsibility lies with the database schema design. Without a unique constraint on the conflict column, the `ON CONFLICT` clause will fail at the database level.
