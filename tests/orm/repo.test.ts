import { v } from 'valleyed'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Adapter, PaginatedResult } from '../../src/orm/adapters/types'
import type { QueryAST } from '../../src/orm/query/types'
import { repo as createRepo } from '../../src/orm/repo/index'
import { schema, Schema } from '../../src/orm/schema/index'

// ============================================================
// Mock Adapter
// ============================================================

type TestRepoConfig = { db: string; col: string }

function createMockAdapter(
	storage: Map<string, Record<string, unknown>[]> = new Map(),
): Adapter<TestRepoConfig> & { calls: { method: string; args: unknown[] }[] } {
	const calls: { method: string; args: unknown[] }[] = []

	function getStore(table: TestRepoConfig): Record<string, unknown>[] {
		const key = `${table.db}.${table.col}`
		if (!storage.has(key)) storage.set(key, [])
		return storage.get(key)!
	}

	return {
		calls,

		async connect() {
			calls.push({ method: 'connect', args: [] })
		},
		async disconnect() {
			calls.push({ method: 'disconnect', args: [] })
		},

		async findMany(_s: Schema, table: TestRepoConfig, _ast: QueryAST) {
			calls.push({ method: 'findMany', args: [table, _ast] })
			return getStore(table)
		},

		async findOne(_s: Schema, table: TestRepoConfig, _ast: QueryAST) {
			calls.push({ method: 'findOne', args: [table, _ast] })
			const store = getStore(table)
			return store[0] ?? null
		},

		async insertOne(_s: Schema, table: TestRepoConfig, data: Record<string, unknown>) {
			calls.push({ method: 'insertOne', args: [table, data] })
			const doc = { ...data, id: 'gen-id-1', createdAt: Date.now(), updatedAt: Date.now() }
			getStore(table).push(doc)
			return doc
		},

		async insertMany(_s: Schema, table: TestRepoConfig, data: Record<string, unknown>[]) {
			calls.push({ method: 'insertMany', args: [table, data] })
			const docs = data.map((d, i) => ({ ...d, id: `gen-id-${i + 1}`, createdAt: Date.now(), updatedAt: Date.now() }))
			getStore(table).push(...docs)
			return docs
		},

		async updateMany(_s: Schema, table: TestRepoConfig, _ast: QueryAST, data: Record<string, unknown>) {
			calls.push({ method: 'updateMany', args: [table, _ast, data] })
			const store = getStore(table)
			const updated = store.map((r) => ({ ...r, ...data, updatedAt: Date.now() }))
			return updated
		},

		async updateOne(_s: Schema, table: TestRepoConfig, _ast: QueryAST, data: Record<string, unknown>) {
			calls.push({ method: 'updateOne', args: [table, _ast, data] })
			const store = getStore(table)
			if (store.length === 0) return null
			return { ...store[0], ...data, updatedAt: Date.now() }
		},

		async upsertOne(_s: Schema, table: TestRepoConfig, _ast: QueryAST, data: any) {
			calls.push({ method: 'upsertOne', args: [table, _ast, data] })
			const doc = { ...data.insert, id: 'upsert-id', createdAt: Date.now(), updatedAt: Date.now() }
			getStore(table).push(doc)
			return doc
		},

		async deleteOne(_s: Schema, table: TestRepoConfig, _ast: QueryAST) {
			calls.push({ method: 'deleteOne', args: [table, _ast] })
			const store = getStore(table)
			return store.shift() ?? null
		},

		async deleteMany(_s: Schema, table: TestRepoConfig, _ast: QueryAST) {
			calls.push({ method: 'deleteMany', args: [table, _ast] })
			const store = getStore(table)
			const removed = [...store]
			store.length = 0
			return removed
		},

		async count(_s: Schema, table: TestRepoConfig, _ast: QueryAST) {
			calls.push({ method: 'count', args: [table, _ast] })
			return getStore(table).length
		},

		async session<T>(cb: () => Promise<T>) {
			calls.push({ method: 'session', args: [] })
			return cb()
		},

		async query(_s: Schema, table: TestRepoConfig, _ast: QueryAST, pagination: { page: number; limit: number; all: boolean }) {
			calls.push({ method: 'paginatedQuery', args: [table, _ast, pagination] })
			const store = getStore(table)
			return {
				pages: { start: 1, last: 1, next: null, previous: null, current: pagination.page },
				docs: { limit: pagination.limit, total: store.length, count: store.length },
				results: store,
			} as PaginatedResult<Record<string, unknown>>
		},
	}
}

// ============================================================
// Test Schemas
// ============================================================

const UserSchema = schema({
	id: v.string(),
	name: v.string(),
	email: v.string(),
	age: v.number(),
}).pk('id', () => 'test-id')

const PostSchema = schema({
	id: v.string(),
	title: v.string(),
	body: v.string(),
	userId: v.string(),
}).pk('id', () => 'test-id')

// ============================================================
// Tests
// ============================================================

describe('orm/repo', () => {
	let adapter: ReturnType<typeof createMockAdapter>

	beforeEach(() => {
		adapter = createMockAdapter()
	})

	describe('repo()', () => {
		it('creates a schema repo', () => {
			const userRepo = createRepo({ adapter: adapter, schema: UserSchema, config: { db: 'test', col: 'users' } })
			expect(userRepo.schema).toBe(UserSchema)
			expect(userRepo.config).toEqual({ db: 'test', col: 'users' })
		})

		it('uses primaryKey from schema', () => {
			const CustomSchema = schema({ _id: v.string(), name: v.string() }).pk('_id', () => 'test-id')
			const customRepo = createRepo({ adapter: adapter, schema: CustomSchema, config: { db: 'test', col: 'items' } })
			expect(customRepo.schema.primaryKey).toBe('_id')
		})
	})

	describe('findById()', () => {
		it('calls adapter.findOne with primary key query', async () => {
			const repo = createRepo({ adapter: adapter, schema: UserSchema, config: { db: 'test', col: 'users' } })
			adapter = createMockAdapter(new Map([['test.users', [{ id: 'abc', name: 'John', email: 'john@test.com', age: 30 }]]]))
			const repo2 = createRepo({ adapter: adapter, schema: UserSchema, config: { db: 'test', col: 'users' } })
			const result = await repo2.findById('abc')
			expect(result).not.toBeNull()
			expect(result!.name).toBe('John')
		})

		it('returns null when not found', async () => {
			const repo = createRepo({ adapter: adapter, schema: UserSchema, config: { db: 'test', col: 'users' } })
			const result = await repo.findById('nonexistent')
			expect(result).toBeNull()
		})
	})

	describe('findOne()', () => {
		it('delegates to adapter.findOne', async () => {
			const storage = new Map([['test.users', [{ id: '1', name: 'Jane', email: 'jane@test.com', age: 25 }]]])
			const a = createMockAdapter(storage)
			const repo = createRepo({ adapter: a, schema: UserSchema, config: { db: 'test', col: 'users' } })
			const result = await repo.findOne()
			expect(result).not.toBeNull()
			expect(result!.name).toBe('Jane')
		})
	})

	describe('findMany()', () => {
		it('returns all matching records', async () => {
			const storage = new Map([
				[
					'test.users',
					[
						{ id: '1', name: 'A', email: 'a@test.com', age: 20 },
						{ id: '2', name: 'B', email: 'b@test.com', age: 30 },
					],
				],
			])
			const a = createMockAdapter(storage)
			const repo = createRepo({ adapter: a, schema: UserSchema, config: { db: 'test', col: 'users' } })
			const results = await repo.findMany()
			expect(results).toHaveLength(2)
		})
	})

	describe('insert()', () => {
		it('validates and inserts data', async () => {
			const repo = createRepo({ adapter: adapter, schema: UserSchema, config: { db: 'test', col: 'users' } })
			const result = await repo.insert({ name: 'John', email: 'john@test.com', age: 25 })
			expect(result.name).toBe('John')
			expect(adapter.calls.some((c) => c.method === 'insertOne')).toBe(true)
		})

		it('throws on invalid data (validation)', async () => {
			const repo = createRepo({ adapter: adapter, schema: UserSchema, config: { db: 'test', col: 'users' } })
			await expect(repo.insert({ name: 123, email: 'x', age: 'not-a-number' })).rejects.toThrow()
		})

		it('throws when required field is missing', async () => {
			const repo = createRepo({ adapter: adapter, schema: UserSchema, config: { db: 'test', col: 'users' } })
			await expect(repo.insert({ name: 'John' } as any)).rejects.toThrow()
		})
	})

	describe('insertMany()', () => {
		it('validates and inserts multiple records', async () => {
			const repo = createRepo({ adapter: adapter, schema: UserSchema, config: { db: 'test', col: 'users' } })
			const results = await repo.insertMany([
				{ name: 'A', email: 'a@t.com', age: 20 },
				{ name: 'B', email: 'b@t.com', age: 30 },
			])
			expect(results).toHaveLength(2)
		})

		it('throws if any record is invalid', async () => {
			const repo = createRepo({ adapter: adapter, schema: UserSchema, config: { db: 'test', col: 'users' } })
			await expect(
				repo.insertMany([
					{ name: 'A', email: 'a@t.com', age: 20 },
					{ name: 123, email: 'b@t.com', age: 30 },
				]),
			).rejects.toThrow()
		})
	})

	describe('update()', () => {
		it('validates partial data and updates', async () => {
			const storage = new Map([['test.users', [{ id: '1', name: 'Old', email: 'old@t.com', age: 20 }]]])
			const a = createMockAdapter(storage)
			const repo = createRepo({ adapter: a, schema: UserSchema, config: { db: 'test', col: 'users' } })
			const results = await repo.update([], { name: 'New' })
			expect(results).toHaveLength(1)
			expect(a.calls.some((c) => c.method === 'updateMany')).toBe(true)
		})

		it('throws on invalid partial data', async () => {
			const repo = createRepo({ adapter: adapter, schema: UserSchema, config: { db: 'test', col: 'users' } })
			await expect(repo.update([], { age: 'not-a-number' })).rejects.toThrow()
		})
	})

	describe('updateById()', () => {
		it('updates a single record by id', async () => {
			const storage = new Map([['test.users', [{ id: 'abc', name: 'Old', email: 'e@t.com', age: 20 }]]])
			const a = createMockAdapter(storage)
			const repo = createRepo({ adapter: a, schema: UserSchema, config: { db: 'test', col: 'users' } })
			const result = await repo.updateById('abc', { name: 'New' })
			expect(result).not.toBeNull()
			expect(a.calls.some((c) => c.method === 'updateOne')).toBe(true)
		})

		it('returns null when record not found', async () => {
			const repo = createRepo({ adapter: adapter, schema: UserSchema, config: { db: 'test', col: 'users' } })
			const result = await repo.updateById('nonexistent', { name: 'X' })
			expect(result).toBeNull()
		})
	})

	describe('delete()', () => {
		it('deletes matching records', async () => {
			const storage = new Map([['test.users', [{ id: '1', name: 'A', email: 'a@t.com', age: 20 }]]])
			const a = createMockAdapter(storage)
			const repo = createRepo({ adapter: a, schema: UserSchema, config: { db: 'test', col: 'users' } })
			const results = await repo.delete()
			expect(results).toHaveLength(1)
		})
	})

	describe('deleteById()', () => {
		it('deletes a single record by id', async () => {
			const storage = new Map([['test.users', [{ id: 'abc', name: 'A', email: 'a@t.com', age: 20 }]]])
			const a = createMockAdapter(storage)
			const repo = createRepo({ adapter: a, schema: UserSchema, config: { db: 'test', col: 'users' } })
			const result = await repo.deleteById('abc')
			expect(result).not.toBeNull()
		})

		it('returns null when not found', async () => {
			const repo = createRepo({ adapter: adapter, schema: UserSchema, config: { db: 'test', col: 'users' } })
			const result = await repo.deleteById('nope')
			expect(result).toBeNull()
		})
	})

	describe('upsert()', () => {
		it('validates and upserts data', async () => {
			const repo = createRepo({ adapter: adapter, schema: UserSchema, config: { db: 'test', col: 'users' } })
			const result = await repo.upsert([], { insert: { name: 'John', email: 'j@t.com', age: 30 } })
			expect(result.name).toBe('John')
			expect(adapter.calls.some((c) => c.method === 'upsertOne')).toBe(true)
		})

		it('validates both insert and update data', async () => {
			const repo = createRepo({ adapter: adapter, schema: UserSchema, config: { db: 'test', col: 'users' } })
			await expect(
				repo.upsert([], {
					insert: { name: 'X', email: 'x@t.com', age: 20 },
					update: { age: 'invalid' },
				}),
			).rejects.toThrow()
		})
	})

	describe('count()', () => {
		it('returns count from adapter', async () => {
			const storage = new Map([['test.users', [{ id: '1' }, { id: '2' }]]])
			const a = createMockAdapter(storage)
			const repo = createRepo({ adapter: a, schema: UserSchema, config: { db: 'test', col: 'users' } })
			const result = await repo.count()
			expect(result).toBe(2)
		})
	})

	describe('paginatedQuery()', () => {
		it('returns paginated results', async () => {
			const storage = new Map([
				[
					'test.users',
					[
						{ id: '1', name: 'A', email: 'a@t.com', age: 20 },
						{ id: '2', name: 'B', email: 'b@t.com', age: 30 },
					],
				],
			])
			const a = createMockAdapter(storage)
			const repo = createRepo({ adapter: a, schema: UserSchema, config: { db: 'test', col: 'users' } })
			const result = await repo.paginatedQuery([], { page: 1, limit: 10 })
			expect(result.results).toHaveLength(2)
			expect(result.pages.current).toBe(1)
			expect(result.docs.total).toBe(2)
		})
	})

	describe('session()', () => {
		it('delegates to adapter.session', async () => {
			const repo = createRepo({ adapter: adapter, schema: UserSchema, config: { db: 'test', col: 'users' } })
			const result = await repo.session(async () => 42)
			expect(result).toBe(42)
			expect(adapter.calls.some((c) => c.method === 'session')).toBe(true)
		})
	})

	describe('with()', () => {
		it('returns a new repo using the given adapter', async () => {
			const storageA = new Map([['test.users', [{ id: '1', name: 'A', email: 'a@t.com', age: 20 }]]])
			const storageB = new Map([['test.users', [{ id: '2', name: 'B', email: 'b@t.com', age: 30 }]]])
			const adapterA = createMockAdapter(storageA)
			const adapterB = createMockAdapter(storageB)

			const repo = createRepo({ adapter: adapterA, schema: UserSchema, config: { db: 'test', col: 'users' } })

			const resultA = await repo.findMany()
			expect(resultA).toHaveLength(1)
			expect(resultA[0].name).toBe('A')

			const resultB = await repo.with(adapterB).findMany()
			expect(resultB).toHaveLength(1)
			expect(resultB[0].name).toBe('B')
		})

		it('preserves schema and config', () => {
			const otherAdapter = createMockAdapter()
			const repo = createRepo({ adapter: adapter, schema: UserSchema, config: { db: 'test', col: 'users' } })
			const swapped = repo.with(otherAdapter)
			expect(swapped.schema).toBe(UserSchema)
			expect(swapped.config).toEqual({ db: 'test', col: 'users' })
		})
	})

	describe('preload()', () => {
		it('preloads a belongsTo association', async () => {
			const userStorage = [{ id: 'u1', name: 'John', email: 'j@t.com', age: 30 }]

			const UserSchemaWithPosts = schema({ id: v.string(), name: v.string(), email: v.string(), age: v.number() }).pk(
				'id',
				() => 'test-id',
			)
			const PostSchemaWithUser = schema({
				id: v.string(),
				title: v.string(),
				body: v.string(),
				userId: v.string(),
			})
				.pk('id', () => 'test-id')
				.belongsTo('user', () => UserSchemaWithPosts, 'userId')

			// For preloads, the findMany/findOne calls go through the adapter
			// The mock adapter stores by table key, but associations need the related schema's table
			// For this test, we use a custom adapter that returns based on the query
			const mockAdapter: Adapter<TestRepoConfig> = {
				async connect() {},
				async disconnect() {},
				async findMany() {
					return userStorage
				},
				async findOne() {
					return userStorage[0]
				},
				async insertOne(_s, _t, d) {
					return d
				},
				async insertMany(_s, _t, d) {
					return d
				},
				async updateMany() {
					return []
				},
				async updateOne() {
					return null
				},
				async upsertOne(_s, _t, _a, d) {
					return d.insert
				},
				async deleteOne() {
					return null
				},
				async deleteMany() {
					return []
				},
				async count() {
					return 0
				},
				async session(cb) {
					return cb()
				},
				async query() {
					return {
						pages: { start: 1, last: 1, next: null, previous: null, current: 1 },
						docs: { limit: 10, total: 0, count: 0 },
						results: [],
					}
				},
			}

			const repo = createRepo({ adapter: mockAdapter, schema: PostSchemaWithUser, config: { db: 'test', col: 'posts' } })
			const post = { id: 'p1', title: 'Hello', body: 'World', userId: 'u1' } as any
			const result = await repo.preload(post, 'user')
			expect(result.user).toBeDefined()
			expect((result.user as any).name).toBe('John')
		})

		it('preloads a hasMany association', async () => {
			const posts = [
				{ id: 'p1', title: 'A', body: 'a', userId: 'u1' },
				{ id: 'p2', title: 'B', body: 'b', userId: 'u1' },
			]

			const UserWithPosts = schema({
				id: v.string(),
				name: v.string(),
				email: v.string(),
				age: v.number(),
			})
				.pk('id', () => 'test-id')
				.hasMany('posts', () => PostSchema, 'userId')

			const mockAdapter: Adapter<TestRepoConfig> = {
				async connect() {},
				async disconnect() {},
				async findMany() {
					return posts
				},
				async findOne() {
					return posts[0]
				},
				async insertOne(_s, _t, d) {
					return d
				},
				async insertMany(_s, _t, d) {
					return d
				},
				async updateMany() {
					return []
				},
				async updateOne() {
					return null
				},
				async upsertOne(_s, _t, _a, d) {
					return d.insert
				},
				async deleteOne() {
					return null
				},
				async deleteMany() {
					return []
				},
				async count() {
					return 0
				},
				async session(cb) {
					return cb()
				},
				async query() {
					return {
						pages: { start: 1, last: 1, next: null, previous: null, current: 1 },
						docs: { limit: 10, total: 0, count: 0 },
						results: [],
					}
				},
			}

			const repo = createRepo({ adapter: mockAdapter, schema: UserWithPosts, config: { db: 'test', col: 'users' } })
			const user = { id: 'u1', name: 'John', email: 'j@t.com', age: 30 } as any
			const result = await repo.preload(user, 'posts')
			expect(Array.isArray(result.posts)).toBe(true)
			expect((result.posts as any[]).length).toBe(2)
		})

		it('throws on unknown association key', async () => {
			const repo = createRepo({ adapter: adapter, schema: UserSchema, config: { db: 'test', col: 'users' } })
			const user = { id: '1', name: 'A', email: 'a@t.com', age: 20 } as any
			await expect((repo as any).preload(user, 'nonexistent')).rejects.toThrow('Unknown association')
		})
	})

	describe('preloadMany()', () => {
		it('batch preloads hasMany for multiple entities', async () => {
			const posts = [
				{ id: 'p1', title: 'A', body: 'a', userId: 'u1' },
				{ id: 'p2', title: 'B', body: 'b', userId: 'u2' },
				{ id: 'p3', title: 'C', body: 'c', userId: 'u1' },
			]

			const UserWithPosts = schema({
				id: v.string(),
				name: v.string(),
				email: v.string(),
				age: v.number(),
			})
				.pk('id', () => 'test-id')
				.hasMany('posts', () => PostSchema, 'userId')

			const mockAdapter: Adapter<TestRepoConfig> = {
				async connect() {},
				async disconnect() {},
				async findMany() {
					return posts
				},
				async findOne() {
					return null
				},
				async insertOne(_s, _t, d) {
					return d
				},
				async insertMany(_s, _t, d) {
					return d
				},
				async updateMany() {
					return []
				},
				async updateOne() {
					return null
				},
				async upsertOne(_s, _t, _a, d) {
					return d.insert
				},
				async deleteOne() {
					return null
				},
				async deleteMany() {
					return []
				},
				async count() {
					return 0
				},
				async session(cb) {
					return cb()
				},
				async query() {
					return {
						pages: { start: 1, last: 1, next: null, previous: null, current: 1 },
						docs: { limit: 10, total: 0, count: 0 },
						results: [],
					}
				},
			}

			const repo = createRepo({ adapter: mockAdapter, schema: UserWithPosts, config: { db: 'test', col: 'users' } })
			const users = [
				{ id: 'u1', name: 'A', email: 'a@t.com', age: 20 },
				{ id: 'u2', name: 'B', email: 'b@t.com', age: 30 },
			] as any[]

			const results = await repo.preloadMany(users, 'posts')
			expect(results).toHaveLength(2)
			// Both should have posts arrays
			expect(Array.isArray(results[0].posts)).toBe(true)
			expect(Array.isArray(results[1].posts)).toBe(true)
		})
	})
})
