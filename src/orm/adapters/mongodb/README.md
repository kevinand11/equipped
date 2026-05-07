# MongoDB Adapter

In-tree MongoDB adapter using the class-via-`configurable` shape.

## Usage

```ts
import { MongoDbAdapter } from 'equipped/orm/adapters/mongodb'
import { Repo } from 'equipped/orm'

const adapter = MongoDbAdapter.create({ uri: 'mongodb://localhost:27017' })

const repo = Repo.from(adapter)
  .resolve((schema) => ({ db: 'myapp', col: schema.name }))
  .build()

// MongoClient is exposed as a readonly field for change streams, aggregations, etc.
const client = adapter.client
```

## Capabilities

| Category | Declared |
|----------|----------|
| `supportedFieldTypes` | `string`, `number`, `boolean`, `null`, `object`, `array`, `date` |
| `queryableOps` | all 13 canonical ops |
| `updateOps` | `set`, `inc`, `mul`, `min`, `max`, `unset`, `push`, `pull`, `patch` |
| Methods | `connect`, `disconnect`, `findByPk`, `createMany`, `updateByPk`, `deleteByPk`, `raw`, `findMany`, `updateMany`, `deleteMany`, `upsertOne`, `session` |

## Session nesting behaviour

`session(fn)` uses MongoDB driver's `ClientSession` + `withTransaction`. Nested sessions (calling `session` inside another `session`) are flat: the inner call detects an active session via `AsyncLocalStorage` and executes `fn()` directly without starting a new transaction. A throw in the inner callback propagates up and rolls back the entire outer transaction.

## Upsert-compatible filter shapes

MongoDB's native upsert (`findOneAndUpdate` with `{ upsert: true }`) accepts any filter shape expressible as a Mongo query document. Unlike PostgreSQL (which requires `ON CONFLICT (col)` targeting a unique constraint), MongoDB does not restrict the filter to unique-indexed fields. Any `FilterGroup` that compiles to a valid Mongo query is accepted.

However, for correctness in concurrent environments, the filter should target fields covered by a unique index. Without a unique index, concurrent upserts with the same filter may both insert (race condition). The adapter does not validate index coverage — that responsibility lies with the database schema design.
