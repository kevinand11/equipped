# ORM Feature Matrix

This file describes three things:

- what the ORM currently provides in `src/orm`
- what is not currently available in the public ORM surface
- what would be reasonable features to implement next

## Available Today

### Schema and typing

- Schema-first modeling with `Schema.from(...)`
- Explicit primary key definition with `.pk(...)`
- Typed field definition with `.field(...)`
- Computed/virtual field definition with `.computed(...)` and strict dependency resolution
- Field lifecycle hooks via `onCreate` and `onUpdate`
- Typed field references that can be reused in query helpers
- Validation of insert and update payloads before persistence
- Shared error handling through `EquippedError`

### Repository API

- `findOne`
- `findMany`
- `insertOne`
- `insertMany`
- `updateOne`
- `updateMany`
- `upsertOne`
- `deleteOne`
- `deleteMany`
- `raw`
- `session`
- `resolve`

### Query API

- `query(...)` to compose filters
- comparison filters: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`
- membership filters: `isIn`, `notIn`
- text filter: `like`
- existence filters: `exists`, `notExists`
- collection / object matching: `contains`, `notContains`
- logical composition: `and(...)`, `or(...)`
- adapter-specific escape hatch with `raw(...)`
- ordering with `orderBy(...)`
- pagination with `limit` and `offset`
- field projection with `select`

### Relations and preload resolution

- `hasOne`
- `hasMany`
- `belongsTo`
- nested preloads
- preload cycle detection
- preload max-depth protection
- typed preload result mapping

### Update operators

- `inc`
- `mul`
- `min`
- `max`
- `unset`
- `push`
- `pull`
- `patch`

### Adapters

- in-memory adapter
- PostgreSQL adapter
- MongoDB adapter

### Runtime behavior

- adapter-specific config resolution per schema via `resolve(...)`
- session-aware execution for transactional adapters
- raw command passthrough when supported by the adapter

## Not Currently Available

These are either commonly expected ORM capabilities or shapes that older/planned docs implied, but they are not part of the current public API.

### API shapes that do not exist today

- no separate fluent model query builder like `.where().limit().offset().select()`

### Missing ORM capabilities

- no aggregate helpers such as `count`, `sum`, `avg`, `min`, `max` queries
- no first-class join API beyond relation preload resolution
- many-to-many relations are modeled explicitly through join schemas by design
- index / unique / constraint definitions are intentionally out of scope for this layer and should live in migrations
- no built-in migration layer in `src/orm`
- no soft-delete abstraction
- no lifecycle hooks around repository operations such as before/after insert or update
- optimistic concurrency can be implemented explicitly with user-defined version fields and query filters
- no eager/lazy relation loading modes beyond explicit preload definitions

## Potential Features To Implement

These are the most natural next steps based on the current implementation and the older planned API notes.

### High-value API improvements

- add a fluent query builder wrapper on top of `QueryFilter` and `QueryOptions`
- add aggregate helpers like `count`, `exists`, and grouped aggregate queries

### Schema and persistence improvements

- add optional soft-delete support
- add timestamps helpers such as `createdAt` / `updatedAt` conventions
- add adapter capability metadata so unsupported features fail earlier and more clearly

### Developer experience improvements

- add more ergonomic preload builder helpers for deeply nested relation graphs
- add better adapter-specific raw typing
- add a dedicated ORM docs page that matches the real API and examples
