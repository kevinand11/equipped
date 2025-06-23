# Equipped

Equipped is a comprehensive, batteries-included, and opinionated full-stack framework for building robust and scalable applications with TypeScript. It provides a cohesive ecosystem of integrated components, including a server, database connectors, caching, a job queue, and an event bus, all managed through a central, type-safe instance.

## Core Features

-   **All-in-One**: Integrated server (Fastify/Express), database (MongoDB), caching (Redis), job queue (Bull/Redis), and event bus (Kafka/RabbitMQ).
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

## Database (MongoDB)

Equipped provides a powerful abstraction layer for MongoDB, including type-safe queries, models, and change streams.

```typescript
// 1. Define a model and an entity class
class UserEntity extends DataClass {
    constructor(data: PipeOutput<typeof UserEntity.schema>) {
        super(data);
    }
    static schema = v.object({
        _id: v.string(),
        name: v.string(),
        email: v.string().pipe(v.email()),
        createdAt: v.number(),
        updatedAt: v.number(),
    });
}

// 2. Configure the database in settings
// dbs: { types: { mongo: { type: 'mongo', uri: envs.MONGO_URI } } }

// 3. Access the table through the instance
const users = instance.dbs.mongo.use<PipeOutput<typeof UserEntity.schema>, UserEntity>({
    db: 'main-db',
    col: 'users',
    mapper: (e) => new UserEntity(e),
    // Optional: Listen for database changes
    change: {
        created: async ({ after }) => console.log(`User created: ${after.name}`),
        updated: async ({ after }) => console.log(`User updated: ${after.name}`),
        deleted: async ({ before }) => console.log(`User deleted: ${before.name}`),
    }
});

// 4. Use the table methods
const newUser = await users.insertOne({ name: 'Jane Doe', email: 'jane@example.com' });
const foundUser = await users.findById(newUser._id);
```

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