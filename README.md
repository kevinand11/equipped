# Equipped

Equipped is a comprehensive, batteries-included, and opinionated full-stack framework for building robust and scalable applications with TypeScript. It provides a cohesive ecosystem of integrated components, including a server, database connectors, caching, a job queue, and an event bus, all managed through a central, type-safe instance.

## Core Features

-   **All-in-One**: Integrated server (Fastify/Express), typed ORM (adapter-agnostic), caching (Redis), job queue (Bull/Redis), and event bus (Kafka/RabbitMQ).
-   **Type-Safe**: End-to-end type safety from environment variables and configuration to database models and API routes.
-   **Modular & Opinionated**: Sensible defaults and a modular design allow you to enable only the features you need, while providing a clear structure for your application.
-   **Lifecycle Management**: Coordinated startup and shutdown hooks (`setup`, `start`, `close`) ensure graceful initialization and termination of all components.
-   **Built-in Validation**: Powered by the `valleyed` library for powerful and composable validation of requests, configurations, and data.
-   **Automatic OpenAPI Docs**: Generate beautiful and interactive API documentation directly from your route definitions.
-   **Real-time Communication**: Integrated WebSockets with a simple, channel-based pub/sub system.
-   **Robust Authentication**: Built-in utilities for handling JWTs and API keys.

## Installation

```bash
npm install equipped
```

## Quick Start

Here's a complete example of a simple Equipped application.

```typescript
// src/index.ts
import { Instance, v, Methods, Router } from 'equipped';

// 1. Define Environment Variables Schema
const envsPipe = v.object({
    PORT: v.coerceNumber().pipe(v.gte(1000)),
    REDIS_URL: v.string(),
});

// 2. Create and Configure the Instance
const instance = Instance.create(envsPipe, (envs) => ({
    app: {
        id: 'my-app',
        name: 'My Awesome App',
    },
    // Enable the server feature
    server: {
        type: 'fastify',
        port: envs.PORT,
    },
    // Enable the cache feature
    cache: {
        type: 'redis',
        host: envs.REDIS_URL,
    },
}));

// 3. Define a Router
const router = new Router();

router.get('/')({
    // Define schema for validation and OpenAPI docs
    schema: {
        response: v.string(),
    },
    // The handler is fully type-safe
    handler: async (req) => {
        // Use the cache
        const cached = await instance.cache.get('my-key');
        if (cached) return `From cache: ${cached}`;

        const message = 'Hello, Equipped!';
        await instance.cache.set('my-key', message, 60);
        return message;
    },
});

// 4. Add the router to the server and start
instance.server?.addRouter(router);
instance.start();
```

## Core Concepts

### Instance Management

The `Instance` class is the heart of an Equipped application. It's a singleton that manages all configured components (server, database, etc.) and their lifecycle.

-   **`Instance.create(envsPipe, settings)`**: Initializes the singleton instance. It must be called only once. It validates environment variables and settings before creating the instance.
-   **`Instance.get()`**: Retrieves the active instance. Throws an error if `create` has not been called.
-   **`Instance.on(event, callback, order)`**: Registers a lifecycle hook.
    -   `setup`: Runs once before `start`. Ideal for setting up connections or listeners.
    -   `start`: Runs after `setup`. The primary phase for starting services.
    -   `close`: Runs when the application is shutting down (e.g., via `SIGINT`).
-   **`Instance.crash(error)`**: Logs an error and gracefully exits the process.

### Configuration

Configuration is split into two parts: environment variables and static settings.

-   **Environment Variables**: Validated at startup using a `valleyed` schema (`envsPipe`). This ensures that all necessary external configurations are present and correctly formatted.
-   **Settings**: A function that takes the validated `envs` and returns a settings object. This object is also validated against a built-in schema to configure all of Equipped's modules.

```typescript
// Example of a full settings object
const settings = (envs) => ({
    app: { id: 'my-app', name: 'My App' },
    log: { level: 'info' },
    server: { type: 'fastify', port: envs.PORT, /* ... */ },
    dbs: {
        types: {
            mongo: { type: 'mongo', uri: envs.MONGO_URI },
        },
        changes: { /* ... */ }
    },
    cache: { type: 'redis', host: envs.REDIS_HOST },
    eventBus: { type: 'kafka', brokers: [envs.KAFKA_BROKER] },
    jobs: { type: 'redis', redisConfig: { host: envs.REDIS_HOST }, queueName: 'my-jobs' },
    utils: { hashSaltRounds: 12 },
});
```

## Server

Equipped provides a robust server layer with support for both **Fastify** (recommended) and **Express**.

### Routing

Routes are defined using the `Router` class. You can nest routers to create modular and organized API endpoints.

```typescript
const users = new Router({ path: '/users' });
const posts = new Router({ path: '/posts' });

// GET /users/:id
users.get('/:id')({
    schema: {
        params: v.object({ id: v.string() }),
        response: v.object({ id: v.string(), name: v.string() }),
    },
    handler: async (req) => {
        const { id } = req.params;
        // const user = await db.users.findById(id);
        // if (!user) throw new NotFoundError();
        return { id, name: 'John Doe' };
    },
});

// Nest the users router under a main router
const mainRouter = new Router({ path: '/api/v1' });
mainRouter.nest(users, posts);

// Add the router to the server
instance.server.addRouter(mainRouter);
```

### Middleware

Middleware can be applied at the router or route level. They are executed in order before the route handler.

```typescript
import { makeMiddleware, requireAuthUser } from 'equipped';

// Custom middleware
const logRequestMiddleware = makeMiddleware(async (req) => {
    instance.log.info(`Request received: ${req.method} ${req.path}`);
});

const router = new Router({
    middlewares: [logRequestMiddleware], // Applied to all routes in this router
});

router.get('/protected')({
    middlewares: [requireAuthUser], // Applied only to this route
    handler: async (req) => {
        // req.authUser is now guaranteed to be defined
        return `Hello, ${req.authUser.id}`;
    },
});
```

### File Uploads

File uploads are handled seamlessly and validated using `valleyed`.

```typescript
const router = new Router();

router.post('/upload')({
    schema: {
        body: v.object({
            avatar: v.incomingFile(), // For a single file
            gallery: v.incomingFiles().pipe(v.max(5)), // For multiple files
        }),
    },
    handler: async (req) => {
        const { avatar, gallery } = req.body;
        // avatar.name, avatar.type, avatar.size, avatar.data (Buffer)
        // gallery is an array of files
        return 'File uploaded successfully';
    },
});
```

## ORM

Equipped ships a typed, capability-aware ORM built on the stack **Schema → Relations → Adapter → Repo**. The package ships no database drivers — adapters (including the in-tree MongoDB and PostgreSQL adapters) declare exactly what they support, and the Repo's TypeScript surface narrows to match. Calling a method the adapter doesn't implement is a compile error, not a runtime throw.

### Defining a Schema

A Schema describes a single document shape — name, primary key, data fields, and optional computed fields. Schemas are adapter-agnostic and carry `valleyed` pipes for validation.

```typescript
import { Schema } from 'equipped/orm'

const UserSchema = Schema.from('users')
    .pk('id', v.string(), () => crypto.randomUUID())
    .field('email', v.string())
    .field('name', v.string())
    .field('age', v.number())
    .field('orgId', v.string())
    .field('tags', v.array(v.string()))
    .field('bio', v.optional(v.string()), { onCreate: () => undefined })
    .field('createdAt', v.number(), { onCreate: () => Date.now() })
    .field('updatedAt', v.number(), {
        onCreate: () => Date.now(),
        onUpdate: () => Date.now(),
    })
    .build()
```

-   **`pk(name, pipe, generator)`** — declares the primary key. The generator runs on insert.
-   **`field(name, pipe, opts?)`** — declares a data field. Optional `onCreate` / `onUpdate` generators auto-inject values.
-   **`computed(name, deps, pipe, compute)`** — declares a derived field computed from persisted dependencies.

Fields with `onUpdate` generators auto-bump on every update unless the update explicitly touches that field.

### Defining Relations

Relations live in a separate artifact from the schema. They wire `hasMany` / `hasOne` / `belongsTo` descriptors using schema-tagged Field references as foreign keys.

```typescript
import { Relations, Schema } from 'equipped/orm'

const PostSchema = Schema.from('posts')
    .pk('id', v.string(), () => crypto.randomUUID())
    .field('title', v.string())
    .field('userId', v.string())
    .build()

const ProfileSchema = Schema.from('profiles')
    .pk('id', v.string(), () => crypto.randomUUID())
    .field('bio', v.string())
    .field('userId', v.string())
    .build()

const OrgSchema = Schema.from('orgs')
    .pk('id', v.string(), () => crypto.randomUUID())
    .field('name', v.string())
    .build()

const UserRelations = Relations.from(UserSchema)
    .hasMany('posts', PostSchema.fields.userId)
    .hasOne('profile', ProfileSchema.fields.userId)
    .belongsTo('org', UserSchema.fields.orgId, OrgSchema)
    .build()
```

-   **`hasMany(name, fk)`** — one-to-many. The FK lives on the target schema; target is inferred from the FK's phantom schema tag.
-   **`hasOne(name, fk)`** — one-to-one. Same FK-driven inference as `hasMany`.
-   **`belongsTo(name, fk, target, references?)`** — many-to-one. The FK lives on the source schema.
-   **FK type-safety** — FKs must be `Field` instances (not raw strings), and pointing a string FK at a number PK is a compile error.
-   **Self-referential** — works without special casing: `belongsTo('manager', src.fields.managerId, UserSchema)`.
-   **Many-to-many** — modelled via an explicit join schema with two `belongsTo` relations.

### Defining an Adapter

An Adapter declares capabilities via three closed canonical sets and four optional behaviour bags, then implements the methods for each bag it declares.

```typescript
import { Adapter } from 'equipped/orm'

const adapter = Adapter.from<{ table: string }>()
    .supportedFieldTypes('string', 'number', 'boolean', 'null', 'object', 'array', 'date')
    .queryableOps('eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn')
    .updateOps('set', 'inc', 'mul')
    .lifecycle({
        connect: async () => { /* open pool */ },
        disconnect: async () => { /* close pool */ },
    })
    .crud({
        findByPk: async (schema, config, pk) => { /* ... */ },
        insertMany: async (schema, config, data) => { /* ... */ },
        updateByPk: async (schema, config, pk, ops) => { /* ... */ },
        deleteByPk: async (schema, config, pk) => { /* ... */ },
        raw: async (schema, config, command, params) => { /* ... */ },
    })
    .queryable({
        findMany: async (schema, config, filter, options) => { /* ... */ },
        updateMany: async (schema, config, filter, data) => { /* ... */ },
        deleteMany: async (schema, config, filter) => { /* ... */ },
        upsertOne: async (schema, config, filter, insert, ops) => { /* ... */ },
    })
    .transactional({
        session: async (fn) => { /* ... */ },
    })
    .build()
```

#### Capability Declarations

| Declaration | Values |
|---|---|
| `supportedFieldTypes` | `string`, `number`, `boolean`, `null`, `object`, `array`, `date` |
| `queryableOps` | `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `notIn`, `like`, `exists`, `notExists`, `contains`, `notContains` |
| `updateOps` | `set`, `inc`, `mul`, `min`, `max`, `unset`, `push`, `pull`, `patch` |

Adapters subset these sets — they cannot extend them. Extension requires a package version bump.

#### Behaviour Bags

| Bag | Methods | Purpose |
|---|---|---|
| `lifecycle` | `connect`, `disconnect` | Connection management |
| `crud` | `findByPk`, `insertMany`, `updateByPk`, `deleteByPk`, `raw` | PK-keyed and raw operations |
| `queryable` | `findMany`, `updateMany`, `deleteMany`, `upsertOne` | Filter-based operations |
| `transactional` | `session` | Transaction support |

Every bag and every method within a bag is independently optional. An adapter that only declares `crud` with `findByPk` is a valid read-only, PK-only adapter.

**Co-required pair**: `.queryable()` requires `.queryableOps()` to have been called with a non-empty list. Calling `.queryable()` without it is both a compile error and a runtime throw.

**No-emulation rule**: the framework never silently emulates a missing op or behaviour client-side. If the adapter doesn't declare it, the Repo method doesn't exist at the type level. Adapter-specific power lives in `raw` only.

The in-tree adapters live under `src/orm/adapters/` — see their individual READMEs for session nesting behaviour and upsert-compatible filter shapes:
-   [MongoDB adapter](src/orm/adapters/mongodb/README.md)
-   [PostgreSQL adapter](src/orm/adapters/postgresql/README.md)

### Defining a Repo

A Repo wraps an adapter and provides the schema-per-call surface. One Repo handles all schemas — no registry, no per-schema derivation.

```typescript
import { Repo } from 'equipped/orm'

const repo = Repo.from(adapter)
    .resolve((schema) => ({ table: schema.name }))
    .build()
```

-   **`Repo.from(adapter)`** — starts the builder, binding the adapter.
-   **`.resolve(fn)`** — maps schema → adapter config. Called once.
-   **`.context(source)`** — optional. Wires a `ContextSource` for per-query config transforms (see [Context & Multi-tenancy](#context--multi-tenancy)).

### Repository API

The Repo exposes two API surfaces: a **schema-per-call** API for direct method invocation and a **fluent builder** API via `repo.from(Schema)`.

#### Schema-per-call API

**CRUD by primary key** (gated by `crud` bag):

```typescript
const user = await repo.findByPk(UserSchema, 'u1')
const created = await repo.insertOne(UserSchema, { email: 'a@b.com', name: 'Alice' })
const batch = await repo.insertMany(UserSchema, [
    { email: 'a@b.com', name: 'Alice' },
    { email: 'b@c.com', name: 'Bob' },
])
const updated = await repo.updateByPk(UserSchema, 'u1', set<typeof UserSchema>({ name: 'New' }))
const deleted = await repo.deleteByPk(UserSchema, 'u1')
const result = await repo.raw(UserSchema, 'SELECT * FROM users WHERE id = $1', ['u1'])
```

**Filter-based methods** (gated by `queryable` bag):

```typescript
const users = await repo.findMany(UserSchema, (q) => q.eq('name', 'Alice'))
const user = await repo.findOne(UserSchema, (q) => q.eq('email', 'a@b.com'))
const updated = await repo.updateOne(
    UserSchema,
    (q) => q.eq('name', 'Alice'),
    { name: 'Alicia' },
)
const allUpdated = await repo.updateMany(
    UserSchema,
    (q) => q.eq('name', 'Same'),
    { name: 'Updated' },
)
const deleted = await repo.deleteOne(UserSchema, (q) => q.eq('name', 'Alice'))
const allDeleted = await repo.deleteMany(UserSchema, (q) => q.eq('name', 'ToDelete'))
```

**Upsert** (gated by `queryable.upsertOne`):

```typescript
const result = await repo.upsertOne(
    UserSchema,
    (q) => q.eq('email', 'a@b.com'),
    { email: 'a@b.com', name: 'Alice', age: 30 },        // full insert payload
    set<typeof UserSchema>({ name: 'Alice Updated' }),      // ops for update path
)
```

Dual-path semantics: if no row matches, the insert payload is persisted and ops are applied on top. If a row exists, the insert payload is ignored and only ops + auto-bump run. The result is always the resulting document.

**Transactions** (gated by `transactional.session`):

```typescript
const result = await repo.session(async () => {
    const user = await repo.insertOne(UserSchema, { email: 'a@b.com', name: 'Alice' })
    await repo.insertOne(PostSchema, { title: 'Hello', userId: user.id })
    return user.id
})
// Throw inside the callback → automatic rollback
```

#### Fluent Builder API

`repo.on(Schema)` returns a builder that branches into `.one()` (single document) or `.all()` (collection).

```typescript
// Insert
const user = await repo.on(UserSchema).one().insert({ email: 'a@b.com', name: 'Alice' })
const users = await repo.on(UserSchema).all().insert([
    { email: 'a@b.com', name: 'Alice' },
    { email: 'b@c.com', name: 'Bob' },
])

// Read by PK
const found = await repo.on(UserSchema).one().id('u1').find()

// Read with filters, ordering, pagination
const results = await repo.on(UserSchema).all()
    .where((q) => q.eq('name', 'Alice'))
    .orderBy('createdAt', 'desc')
    .limit(10)
    .offset(20)
    .find()

// Select specific fields
const partial = await repo.on(UserSchema).all()
    .select(['id', 'name'])
    .find()

// Preload relations
const withPosts = await repo.on(UserSchema).one().id('u1')
    .preload([UserRelations.posts, UserRelations.org])
    .find()

// Update
const updated = await repo.on(UserSchema).one().id('u1').update({ name: 'New Name' })
const allUpdated = await repo.on(UserSchema).all()
    .where((q) => q.eq('name', 'Old'))
    .update({ name: 'New' })

// Upsert
const upserted = await repo.on(UserSchema).one()
    .where((q) => q.eq('email', 'a@b.com'))
    .upsert({ insert: { email: 'a@b.com', name: 'Alice' } })

// Delete
const deleted = await repo.on(UserSchema).one().id('u1').delete()
const allDeleted = await repo.on(UserSchema).all()
    .where((q) => q.eq('name', 'ToDelete'))
    .delete()

// Raw
const raw = await repo.on(UserSchema).raw('SELECT * FROM users')
```

Builder snapshots are immutable — branching from a base builder does not mutate the original.

#### Method Gating

Every Repo method is gated by the adapter's capability declarations. Methods whose bag or sub-method isn't declared collapse to `never` at the type level:

| Repo method | Required adapter capability |
|---|---|
| `findByPk` | `crud.findByPk` |
| `insertOne` / `insertMany` | `crud.insertMany` |
| `updateByPk` | `crud.updateByPk` |
| `deleteByPk` | `crud.deleteByPk` |
| `raw` | `crud.raw` |
| `findOne` / `findMany` | `queryable.findMany` |
| `updateOne` / `updateMany` | `queryable.updateMany` |
| `deleteOne` / `deleteMany` | `queryable.deleteMany` |
| `upsertOne` | `queryable.upsertOne` |
| `session` | `transactional.session` |

A schema with a field type not in `supportedFieldTypes` resolves to `never` in the schema argument position — the call won't compile.

### Filters (Query API)

Filter-based Repo methods accept a factory `(q) => q.op(field, value)` that builds a `FilterGroup`. Every method on `FilterGroup` maps to one of the 13 canonical filter ops:

| Op | Signature | Description |
|---|---|---|
| `eq` | `q.eq(field, value)` | Equal |
| `ne` | `q.ne(field, value)` | Not equal |
| `gt` | `q.gt(field, value)` | Greater than |
| `gte` | `q.gte(field, value)` | Greater than or equal |
| `lt` | `q.lt(field, value)` | Less than |
| `lte` | `q.lte(field, value)` | Less than or equal |
| `in` | `q.in(field, values)` | In array |
| `notIn` | `q.notIn(field, values)` | Not in array |
| `like` | `q.like(field, pattern)` | Substring match |
| `exists` | `q.exists(field)` | Field is non-null |
| `notExists` | `q.notExists(field)` | Field is null/undefined (its own op, not a boolean form of `exists`) |
| `contains` | `q.contains(field, values)` | Array contains subset |
| `notContains` | `q.notContains(field, values)` | Array does not contain subset |

Structural combinators build compound filters:

```typescript
// AND — all conditions must match
q.and([
    (g) => g.gt('age', 18),
    (g) => g.eq('active', true),
])

// OR — any condition matches
q.or([
    (g) => g.eq('role', 'admin'),
    (g) => g.eq('role', 'superadmin'),
])
```

Filters can reference fields by name (string) or by schema-tagged Field reference (`UserSchema.fields.email`). Empty `and([])` / `or([])` throws at builder time. Unknown fields throw `OrmValidationError` at the Repo-entry boundary.

Filter ops are gated per-adapter: the `FilterGroup` passed to a Repo method only exposes ops declared in the adapter's `queryableOps`. Undeclared ops are `never` at the type level.

### Update Operations

The `updateByPk` method and `upsertOne` accept typed update ops. Nine canonical op helpers are exported from `equipped/orm`:

| Op | Helper | Target |
|---|---|---|
| `set` | `set<Schema>({ field: value })` | Any field (partial) |
| `inc` | `inc<Schema>(field, value)` | Numeric fields |
| `mul` | `mul<Schema>(field, value)` | Numeric fields |
| `min` | `min<Schema>(field, value)` | Comparable fields |
| `max` | `max<Schema>(field, value)` | Comparable fields |
| `unset` | `unset<Schema>(field)` | Optional fields |
| `push` | `push<Schema>(field, value)` | Array fields |
| `pull` | `pull<Schema>(field, value)` | Array fields |
| `patch` | `patch<Schema>(field, value)` | Object fields |

```typescript
import { set, inc, push } from 'equipped/orm'

await repo.updateByPk(
    UserSchema, 'u1',
    set<typeof UserSchema>({ name: 'Alice' }),
    inc<typeof UserSchema>(UserSchema.fields.age, 1),
    push<typeof UserSchema>(UserSchema.fields.tags, 'premium'),
)
```

-   `updateByPk` requires at least one op (enforced at the type level).
-   Conflicting ops on the same field (e.g. `set({ views: 0 })` + `inc(views, 1)`) throw `OrmValidationError` with `kind: 'conflicting-ops'`.
-   Only `set` values are pipe-validated; atomic op operands are not.
-   Op availability is gated by the adapter's `updateOps` declaration — undeclared ops resolve to `never`.

### Context & Multi-tenancy

`repo.resolve(transform, fn)` scopes a block of queries with an explicit config override. It uses `AsyncLocalStorage` internally — transforms are visible to all queries within `fn`, including preload sub-queries and queries inside sessions. Parallel calls do not bleed into each other.

```typescript
import { type ConfigTransform, Repo } from 'equipped/orm'

type MyConfig = { table: string; tenantPrefix?: string }

const repo = Repo.from(adapter)
    .resolve((schema) => ({ table: schema.name }))
    .build()

// Per-request scope entry
app.use((req, res, next) => {
    const tenantId = req.headers['x-tenant-id']
    repo.resolve(
        (config) => ({ ...config, tenantPrefix: tenantId }),
        next,
    )
})
```

**How it works**: `repo.resolve(transform, fn)` pushes a `ConfigTransform` onto the ALS context for the duration of `fn`. The transform is applied to the base config (from the builder's `.resolve()`) before the adapter receives it. Nested `repo.resolve()` calls compose — inner transforms see the outer-transformed config.

**Patterns**:

-   **Hono / Express middleware**: call `repo.resolve(transform, next)` in middleware to scope all downstream queries.
-   **Explicit per-operation**: wrap a single operation for ad-hoc config overrides.

**Footgun mitigations**: without a `repo.resolve()` scope, all queries run with the base config. To fail loud on missing tenant context, have your transform throw when the expected value is absent.

### Builder-chain Pattern Overview

All declarative artifact construction (`Schema.from()`, `Relations.from()`, `Adapter.from()`, `Repo.from()`) uses a uniform **static-factory builder-chain** pattern:

```typescript
const artifact = X.from(args)
    .stepA(...)
    .stepB(...)
    .stepC(...)
    .build()
```

**Rules**:

-   **Once-per-step**: each builder step can be called at most once. Duplicate calls are compile errors via a uniqueness guard (`K extends keyof Acc ? never : K`).
-   **Per-step coherence**: each step validates its own constraints at the call site. For example, `.queryable()` requires `.queryableOps()` to have been called first with a non-empty list.
-   **Omission-equals-empty**: a step not called means the artifact doesn't declare that capability. Op-list fields default to `readonly []`; behaviours default to absent.
-   **Name-parity convention**: builder method names match the capability names they declare (`.queryableOps()` declares `queryableOps`, `.crud()` declares `crud`, etc.).

This pattern applies only to **definitions** (static artifact construction). **Operations** (Repo method calls, `repo.session()`, op helpers like `set()`) use direct function calls.

## Caching (Redis)

A simple and effective caching layer backed by Redis is available on the instance.

```typescript
// Set a value with a TTL of 60 seconds
await instance.cache.set('my-key', JSON.stringify({ data: 'value' }), 60);

// Get a value
const value = await instance.cache.get('my-key');

// Get a value, or if it doesn't exist, execute a function,
// cache its result, and return it.
const data = await instance.cache.getOrSet('expensive-data', async () => {
    // some expensive operation
    return { result: 42 };
}, 3600); // Cache for 1 hour
```

## Job Queue (Redis)

Equipped includes a job queue system built on Bull and Redis for handling background tasks.

```typescript
// In settings:
// jobs: { type: 'redis', redisConfig: { ... }, queueName: 'my-queue' }

// Define job types (in src/types/overrides.ts)
export interface DelayedJobs {
    'send-email': { to: string; subject: string; body: string };
}
export interface CronTypes {
    'cleanup-tasks': 'cleanup-tasks';
}

// Add a delayed job
await instance.jobs.addDelayed({
    type: 'send-email',
    data: { to: 'user@example.com', subject: 'Welcome!', body: '...' }
}, 5000); // Delay for 5 seconds

// Configure cron jobs and callbacks
instance.jobs.crons = [
    { name: 'cleanup-tasks', cron: '0 0 * * *' } // Every day at midnight
];
instance.jobs.callbacks = {
    onDelayed: async (job) => {
        if (job.type === 'send-email') {
            // send email logic
        }
    },
    onCron: async (name) => {
        if (name === 'cleanup-tasks') {
            // cleanup logic
        }
    }
};
```

## Event Bus (Kafka / RabbitMQ)

Facilitate communication between services with a high-level event bus abstraction.

```typescript
// In settings:
// eventBus: { type: 'kafka', brokers: [...] }

// Define event types (in src/types/overrides.ts)
export interface Events {
    'user-registered': { topic: 'user-registered'; data: { userId: string; email: string } };
}

// Publish an event
const publishUserRegistered = instance.eventBus.createPublisher('user-registered');
await publishUserRegistered({ userId: '123', email: 'test@example.com' });

// Subscribe to an event
instance.eventBus.createSubscriber('user-registered', async (data) => {
    console.log(`New user registered: ${data.email}`);
});
```

## Real-time Communication (Sockets)

Equipped provides a real-time layer over Socket.IO, integrated with the event bus for horizontal scaling.

```typescript
// Register a socket channel and its authorization logic
instance.server.socket.register('/posts/:id', async ({ channel, user }, params, query) => {
    // This function is called when a client tries to join a room.
    // It should return a string (or null) to scope the room.
    // Here, we allow any authenticated user to join.
    if (user) return user.id;
    return null; // Deny access
});

// Emit events to clients in a room
// This will send a 'created' event to the '/posts/post-123' channel,
// specifically to the room scoped for 'user-456'.
await instance.server.socket.created(['/posts/post-123'], newPostEntity, 'user-456');
```

## Authentication

Equipped provides utilities for token-based authentication.

```typescript
// Use the built-in CacheTokensUtility
const tokens = new CacheTokensUtility();

// In server settings:
// requestsAuth: { tokens }

// Create tokens
const accessToken = await tokens.createAccessToken({ id: 'user-123' });
const refreshToken = await tokens.createRefreshToken({ id: 'user-123' });

// Use middleware to protect routes
import { requireAuthUser } from 'equipped';
router.get('/profile', {
    middlewares: [requireAuthUser],
    handler: async (req) => {
        return { user: req.authUser };
    }
});
```

## Validation

Validation is a first-class citizen, powered by `valleyed`. Schemas are defined for route `params`, `query`, `headers`, and `body`.

```typescript
router.post('/register')({
    schema: {
        body: v.object({
            name: v.string().pipe(v.min(2)),
            email: v.string().pipe(v.email()),
            password: v.string().pipe(v.min(8)),
        }),
        response: v.object({
            id: v.string(),
            name: v.string(),
        }),
    },
    handler: async (req) => {
        // req.body is fully typed and validated
        const { name, email, password } = req.body;
        // ... create user logic
        return { id: 'new-user-id', name };
    },
});
```

## Error Handling

Equipped has a set of predefined `RequestError` classes that map to HTTP status codes. The framework includes a global error handler that catches errors and formats them into a consistent JSON response.

```typescript
import { NotFoundError } from 'equipped';

router.get('/items/:id')({
    handler: async (req) => {
        const item = await findItem(req.params.id);
        if (!item) {
            // This will be caught and sent as a 404 response
            throw new NotFoundError('Item not found');
        }
        return item;
    }
});
```

## Contributing

Contributions are welcome! Please open an issue or submit a pull request on our GitHub repository.

## License

This project is licensed under the MIT License.