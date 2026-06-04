# Iteration batch size and PostgreSQL cursor-backed iteration

The ORM's `AllBuilder.iterate()` terminal accepts an iteration-options object (`.iterate({ batchSize })`) rather than a positional number, and `batchSize` is iteration-only rather than part of shared `QueryOptions`. Omitted `batchSize` defers to the backend/default cursor behavior; invalid values fail at the Repo-entry boundary as `OrmValidationError(kind: 'query-shape', operation: 'iterate')`. PostgreSQL iteration uses `pg-cursor` with a cursor owned for the async generator lifetime: outside a session it acquires/releases a dedicated client, while inside `repo.session(...)` it uses the active session client and closes only the cursor.

## Considered Options

- **Positional `.iterate(500)`.** Rejected because an options object leaves room for future iteration-only controls without another signature change.
- **Framework default batch size.** Rejected because backend cursor defaults differ and callers who care can opt in explicitly with `batchSize`.
- **Put `batchSize` on shared `QueryOptions`.** Rejected because `findMany`, `paginate`, and `count` should not receive or ignore an iteration-only concern.
- **Optional/peer `pg-cursor` dependency.** Rejected because the in-tree PostgreSQL adapter should support documented `.iterate()` behavior out of the box.
- **Reject iteration inside sessions.** Rejected because using the active session client preserves transaction consistency; the cursor can be closed without releasing the session-owned client.

## Consequences

- In-tree cursor-capable adapters honor `batchSize` where their backend exposes chunk sizing: PostgreSQL via `pg-cursor`, MongoDB via cursor batch sizing; in-memory/json preserve yielded order/cardinality using internal chunks only.
- `.limit()` remains the result-set cap; `batchSize` only controls backend fetch chunk size.
- PostgreSQL iteration must close cursors and release any dedicated client in `finally` so early `break` and consumer-thrown errors do not leak pool clients.
