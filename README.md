# Equipped

A comprehensive TypeScript framework for building scalable backend applications with built-in support for web servers, databases, caching, job queues, event buses, authentication, and real-time communication.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Features](#core-features)
- [Instance Management](#instance-management)
- [Server](#server)
- [Database](#database)
- [Caching](#caching)
- [Job Queue](#job-queue)
- [Event Bus](#event-bus)
- [Real-time Communication](#real-time-communication)
- [Authentication](#authentication)
- [Validation](#validation)
- [Error Handling](#error-handling)
- [Utilities](#utilities)
- [Configuration](#configuration)
- [API Reference](#api-reference)

## Installation

```bash
npm install equipped
```

## Requirements

- Node.js >= 20.0.0
- TypeScript support
- Redis (for caching and jobs)
- MongoDB (for database)
- Kafka or RabbitMQ (for event bus)

## Quick Start

```typescript
import { Instance, v } from 'equipped'

// Define environment variables validation
const envsPipe = v.object({
  PORT: v.string().transform(Number),
  MONGO_URI: v.string(),
  REDIS_URI: v.string(),
})

// Create instance with configuration
const instance = Instance.create(envsPipe, (envs) => ({
  app: 'my-app',
  server: {
    type: 'express',
    port: envs.PORT,
  },
  db: {
    mongo: { uri: envs.MONGO_URI },
  },
  cache: {
    type: 'redis',
    config: { uri: envs.REDIS_URI },
  },
  // ... other configurations
}))

// Start the application
await instance.start()
```

## Core Features

### Instance Management

The `Instance` class is the central orchestrator that manages all application components:

```typescript
import { Instance } from 'equipped'

// Create singleton instance
const instance = Instance.create(envsPipe, settings)

// Get existing instance anywhere in your app
const instance = Instance.get()

// Access components
instance.server    // Web server (Express/Fastify)
instance.cache     // Redis cache
instance.dbs.mongo // MongoDB connection
instance.job       // Job queue
instance.eventBus  // Event bus
instance.listener  // Socket.IO listener
instance.logger    // Pino logger
```

#### Lifecycle Hooks

```typescript
// Add hooks for application lifecycle
Instance.addHook('pre:start', async () => {
  console.log('Before start')
})

Instance.addHook('post:start', async () => {
  console.log('After start')
})

Instance.addHook('pre:close', async () => {
  console.log('Before shutdown')
})
```

## Server

Equipped supports both Express and Fastify servers with a unified API.

### Route Definition

```typescript
import { Routes, v, makeMiddleware } from 'equipped'

const routes = Routes.create('/api')

// Define route with validation
routes.post('/users', {
  schema: {
    body: v.object({
      name: v.string(),
      email: v.string().email(),
    }),
    response: v.object({
      id: v.string(),
      name: v.string(),
      email: v.string(),
    }),
  },
  handler: async (req) => {
    // req.body is typed based on schema
    const user = await createUser(req.body)
    return user
  },
})

// Route with parameters
routes.get('/users/:id', {
  schema: {
    params: v.object({
      id: v.string(),
    }),
  },
  handler: async (req) => {
    const user = await getUserById(req.params.id)
    return user
  },
})
```

### Middleware

```typescript
// Custom middleware
const authMiddleware = makeMiddleware(async (req) => {
  const token = req.headers.authorization
  if (!token) throw new NotAuthenticatedError()
  
  const user = await verifyToken(token)
  req.user = user
})

// Apply middleware to routes
routes.post('/protected', {
  middlewares: [authMiddleware],
  handler: async (req) => {
    // req.user is available
    return { message: 'Protected route', user: req.user }
  },
})
```

### Server Configuration

```typescript
// Express server
{
  server: {
    type: 'express',
    port: 3000,
    cors: {
      origin: 'http://localhost:3000',
      credentials: true,
    },
    rateLimit: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // limit each IP to 100 requests per windowMs
    },
  }
}

// Fastify server
{
  server: {
    type: 'fastify',
    port: 3000,
    // Fastify-specific options
  }
}
```

### File Uploads

```typescript
routes.post('/upload', {
  schema: {
    body: v.object({
      files: v.array(v.object({
        name: v.string(),
        type: v.string(),
        data: v.instanceof(Buffer),
      })),
    }),
  },
  handler: async (req) => {
    const files = req.body.files
    // Process uploaded files
    return { uploaded: files.length }
  },
})
```

## Database

### MongoDB Integration

```typescript
import { MongoEntity, MongoRepository } from 'equipped'

// Define entity
class User extends MongoEntity {
  constructor(data: UserData) {
    super(data)
  }
  
  static schema = v.object({
    name: v.string(),
    email: v.string().email(),
    createdAt: v.date().default(() => new Date()),
  })
}

// Repository pattern
class UserRepository extends MongoRepository<User> {
  constructor() {
    super('users', User)
  }
  
  async findByEmail(email: string) {
    return await this.findOne({ email })
  }
}

// Usage
const userRepo = new UserRepository()
const user = await userRepo.create({
  name: 'John Doe',
  email: 'john@example.com',
})
```

### Database Change Streams

```typescript
// Listen to database changes
const callbacks: DbChangeCallbacks = {
  created: async (doc) => {
    console.log('Document created:', doc)
  },
  updated: async (doc) => {
    console.log('Document updated:', doc)
  },
  deleted: async (doc) => {
    console.log('Document deleted:', doc)
  },
}

// Register callbacks for a collection
instance.dbs.mongo.registerChangeCallbacks('users', callbacks)
```

## Caching

Redis-based caching with automatic serialization:

```typescript
const cache = instance.cache

// Basic operations
await cache.set('key', 'value', 3600) // TTL in seconds
const value = await cache.get('key')
await cache.delete('key')

// Get or set pattern
const expensiveData = await cache.getOrSet(
  'expensive-operation',
  async () => {
    // This function only runs if cache miss
    return await performExpensiveOperation()
  },
  3600 // TTL
)
```

## Job Queue

Redis-based job queue with support for delayed jobs, cron jobs, and retries:

```typescript
const job = instance.job

// Delayed job
const jobId = await job.addDelayedJob(
  { type: 'send-email', email: 'user@example.com' },
  5000 // 5 seconds delay
)

// Cron-like job
const cronJobKey = await job.addCronLikeJob(
  { type: 'daily-report' },
  '0 9 * * *' // Every day at 9 AM
)

// Process jobs
await job.startProcessingQueues(
  [
    { name: 'weekly-cleanup', cron: '0 0 * * 0' }, // Weekly cron
  ],
  {
    onDelayed: async (data) => {
      console.log('Processing delayed job:', data)
    },
    onCron: async (cronName) => {
      console.log('Processing cron job:', cronName)
    },
    onCronLike: async (data) => {
      console.log('Processing cron-like job:', data)
    },
  }
)

// Remove jobs
await job.removeDelayedJob(jobId)
await job.removeCronLikeJob(cronJobKey)
```

## Event Bus

Supports both Kafka and RabbitMQ for distributed event handling:

```typescript
// Define events (in types/overrides.ts)
export interface Events {
  'user.created': {
    topic: 'user.created'
    data: { userId: string; email: string }
  }
  'order.completed': {
    topic: 'order.completed'
    data: { orderId: string; amount: number }
  }
}

// Publisher
const publisher = instance.eventBus.createPublisher('user.created')
await publisher.publish({ userId: '123', email: 'user@example.com' })

// Subscriber
const subscriber = instance.eventBus.createSubscriber(
  'user.created',
  async (data) => {
    console.log('User created:', data)
    // Handle the event
  },
  { fanout: true } // Broadcast to all instances
)

await subscriber.subscribe()
```

### Event Bus Configuration

```typescript
// Kafka
{
  eventBus: {
    type: 'kafka',
    config: {
      clientId: 'my-app',
      brokers: ['localhost:9092'],
    }
  }
}

// RabbitMQ
{
  eventBus: {
    type: 'rabbitmq',
    config: {
      uri: 'amqp://localhost',
    }
  }
}
```

## Real-time Communication

Socket.IO integration with room management and authentication:

```typescript
const listener = instance.listener

// Register channel handlers
listener.register('notifications/:userId', async ({ channel, user }, params, query) => {
  // Authorize user to join this channel
  if (!user || user.id !== params.userId) {
    return null // Deny access
  }
  
  // Return scope (user ID for private channels)
  return user.id
})

// Emit events
await listener.created(
  ['notifications'], // channels
  userData, // data
  'user-123' // scope (optional)
)

await listener.updated(
  ['user-profile'],
  { after: newUserData, before: oldUserData },
  'user-123'
)

await listener.deleted(
  ['notifications'],
  deletedData,
  'user-123'
)
```

### Client-side Socket.IO

```javascript
const socket = io('http://localhost:3000', {
  auth: {
    authorization: 'Bearer ' + accessToken
  }
})

// Join a channel
socket.emit('join', {
  channel: 'notifications/user-123',
  query: { filter: 'important' }
}, (response) => {
  console.log('Join response:', response)
})

// Listen for events
socket.on('notifications/user-123', (data) => {
  console.log('Notification:', data)
})

// Leave channel
socket.emit('leave', { channel: 'notifications/user-123' })
```

## Authentication

### JWT Tokens

```typescript
import { Tokens } from 'equipped'

const tokens = new Tokens({
  accessToken: {
    secret: 'your-secret',
    ttl: 15 * 60, // 15 minutes
  },
  refreshToken: {
    secret: 'your-refresh-secret',
    ttl: 7 * 24 * 60 * 60, // 7 days
  },
})

// Generate tokens
const { accessToken, refreshToken } = await tokens.generate({
  id: 'user-123',
  email: 'user@example.com',
})

// Verify tokens
const user = await tokens.verifyAccessToken(accessToken)
const user = await tokens.verifyRefreshToken(refreshToken)

// Refresh tokens
const newTokens = await tokens.refresh(refreshToken)
```

### API Keys

```typescript
import { ApiKeys } from 'equipped'

const apiKeys = new ApiKeys({
  keys: [
    { key: 'api-key-1', userId: 'user-123' },
    { key: 'api-key-2', userId: 'user-456' },
  ],
})

// Verify API key
const user = await apiKeys.verify('api-key-1')
```

### Social Authentication

```typescript
import { signinWithGoogle, signinWithApple, signinWithFacebook } from 'equipped'

// Google OAuth
const googleUser = await signinWithGoogle(idToken)
console.log(googleUser.email, googleUser.first_name, googleUser.last_name)

// Apple OAuth
const appleUser = await signinWithApple(idToken)
console.log(appleUser.email, appleUser.sub)

// Facebook OAuth
const facebookUser = await signinWithFacebook(accessToken, ['email', 'name'])
console.log(facebookUser.email, facebookUser.name)
```

## Validation

Built on top of `valleyed` with enhanced error handling:

```typescript
import { v, validate, pipeErrorToValidationError } from 'equipped'

// Define schemas
const userSchema = v.object({
  name: v.string().min(2).max(50),
  email: v.string().email(),
  age: v.number().min(18).max(120),
  tags: v.array(v.string()).optional(),
})

// Validate data
try {
  const user = validate(userSchema, rawData)
  console.log('Valid user:', user)
} catch (error) {
  if (error instanceof ValidationError) {
    console.log('Validation errors:', error.errors)
  }
}

// Common validation patterns
const querySchema = v.object({
  page: v.string().transform(Number).default(1),
  limit: v.string().transform(Number).max(100).default(10),
  search: v.string().optional(),
})
```

## Error Handling

Comprehensive error types with proper HTTP status codes:

```typescript
import {
  EquippedError,
  ValidationError,
  NotFoundError,
  NotAuthenticatedError,
  NotAuthorizedError,
  BadRequestError,
} from 'equipped'

// Custom application errors
throw new NotFoundError('User not found')
throw new NotAuthenticatedError('Invalid credentials')
throw new NotAuthorizedError('Insufficient permissions')
throw new BadRequestError('Invalid request format')

// Validation errors
throw new ValidationError([
  { field: 'email', messages: ['Invalid email format'] },
  { field: 'age', messages: ['Must be at least 18'] },
])

// Generic equipped errors
throw new EquippedError('Something went wrong', { context: 'additional data' })
```

### Error Middleware

```typescript
const errorHandler = makeErrorMiddleware(async (req, error) => {
  console.error('Route error:', error)
  
  if (error instanceof ValidationError) {
    return {
      statusCode: 422,
      response: error.serializedErrors,
      responseHeaders: {},
    }
  }
  
  return {
    statusCode: 500,
    response: [{ field: '', messages: ['Internal server error'] }],
    responseHeaders: {},
  }
})

routes.post('/example', {
  onError: errorHandler,
  handler: async (req) => {
    // Route logic
  },
})
```

## Utilities

### Hashing

```typescript
import { Hash } from 'equipped'

// Hash password
const hashedPassword = await Hash.hash('user-password')

// Compare password
const isValid = await Hash.compare('user-password', hashedPassword)
```

### Random Generation

```typescript
import { Random } from 'equipped'

// Generate random string
const randomId = Random.string(20) // 20 characters

// Generate random number
const randomNum = Random.number(1, 100) // Between 1 and 100
```

### Retry Logic

```typescript
import { retry, sleep } from 'equipped'

// Retry with exponential backoff
const result = await retry(
  async () => {
    const response = await unstableApiCall()
    if (response.success) {
      return { done: true, value: response.data }
    }
    return { done: false }
  },
  3, // max attempts
  1000 // wait time in ms
)

// Simple sleep
await sleep(5000) // Wait 5 seconds
```

### Cloning

```typescript
import { clone } from 'equipped'

const original = { a: 1, b: { c: 2 } }
const copy = clone(original) // Deep clone using structuredClone
```

## Configuration

### Complete Configuration Example

```typescript
const settings = {
  app: 'my-application',
  
  server: {
    type: 'express',
    port: 3000,
    cors: {
      origin: process.env.FRONTEND_URL,
      credentials: true,
    },
    rateLimit: {
      windowMs: 15 * 60 * 1000,
      max: 100,
    },
  },
  
  db: {
    mongo: {
      uri: process.env.MONGO_URI,
      dbName: 'myapp',
    },
  },
  
  cache: {
    type: 'redis',
    config: {
      uri: process.env.REDIS_URI,
    },
  },
  
  jobs: {
    queueName: 'myapp-jobs',
    config: {
      uri: process.env.REDIS_URI,
    },
  },
  
  eventBus: {
    type: 'kafka',
    config: {
      clientId: 'myapp',
      brokers: [process.env.KAFKA_BROKER],
    },
  },
  
  dbChanges: {
    kafkaConfig: {
      clientId: 'myapp-db-changes',
      brokers: [process.env.KAFKA_BROKER],
    },
  },
  
  requestsAuth: {
    tokens: new Tokens({
      accessToken: {
        secret: process.env.JWT_SECRET,
        ttl: 15 * 60,
      },
      refreshToken: {
        secret: process.env.JWT_REFRESH_SECRET,
        ttl: 7 * 24 * 60 * 60,
      },
    }),
    apiKeys: new ApiKeys({
      keys: JSON.parse(process.env.API_KEYS),
    }),
  },
  
  utils: {
    hashSaltRounds: 12,
  },
  
  log: {
    level: 'info',
  },
}
```

## API Reference

### Core Classes

- `Instance`: Main application orchestrator
- `Routes`: Route definition and management
- `MongoEntity`: Base class for MongoDB entities
- `MongoRepository`: Repository pattern for MongoDB
- `Cache`: Abstract cache interface
- `RedisCache`: Redis cache implementation
- `RedisJob`: Redis-based job queue
- `EventBus`: Abstract event bus interface
- `KafkaEventBus`: Kafka event bus implementation
- `RabbitEventBus`: RabbitMQ event bus implementation
- `Listener`: Socket.IO real-time communication
- `Tokens`: JWT token management
- `ApiKeys`: API key authentication

### Error Classes

- `EquippedError`: Base error class
- `RequestError`: HTTP request errors
- `ValidationError`: Validation errors
- `NotFoundError`: 404 errors
- `NotAuthenticatedError`: 401 errors
- `NotAuthorizedError`: 403 errors
- `BadRequestError`: 400 errors

### Validation

- All validation utilities from `valleyed`
- Enhanced error handling for HTTP contexts
- Common schema patterns for web applications

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License

ISC License

## Support

For questions and support, please open an issue on the GitHub repository.