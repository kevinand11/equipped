import { writeFile, readFile, rename } from 'node:fs/promises'

import { EquippedError } from '../../../errors'
import { Adapter } from '../../adapter'
import { createInMemoryAdapter, type InMemoryRepoConfig } from '../in-memory'

export type JsonAdapterConfig = InMemoryRepoConfig

/** Single-process writer. Multi-process file locking is out of scope. */
export function createJsonAdapter(options: { filePath: string }) {
	const { filePath } = options
	const { adapter: inMemory, stores } = createInMemoryAdapter()

	let writeQueue: Promise<void> = Promise.resolve()

	function serializeStores(): string {
		const obj: Record<string, Record<string, Record<string, unknown>>> = {}
		for (const [name, store] of stores.entries()) {
			const records: Record<string, Record<string, unknown>> = {}
			for (const [pk, doc] of store.entries()) {
				records[pk] = doc
			}
			obj[name] = records
		}
		return JSON.stringify(obj)
	}

	async function atomicWrite(): Promise<void> {
		const data = serializeStores()
		const tmpPath = filePath + '.tmp.' + process.pid + '.' + Date.now()
		await writeFile(tmpPath, data, 'utf-8')
		await rename(tmpPath, filePath)
	}

	function persistToDisk(): Promise<void> {
		const next = writeQueue.then(() => atomicWrite())
		writeQueue = next.catch(() => {})
		return next
	}

	async function loadFromDisk(): Promise<void> {
		let raw: string
		try {
			raw = await readFile(filePath, 'utf-8')
		} catch {
			return
		}
		const data = JSON.parse(raw) as Record<string, Record<string, Record<string, unknown>>>
		stores.clear()
		for (const [name, records] of Object.entries(data)) {
			const store = new Map<string, Record<string, unknown>>()
			for (const [pk, doc] of Object.entries(records)) {
				store.set(pk, doc)
			}
			stores.set(name, store)
		}
	}

	const adapter = Adapter.from<JsonAdapterConfig>()
		.supportedFieldTypes('string', 'number', 'boolean', 'null', 'object', 'array', 'date')
		.queryableOps('eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'like', 'exists', 'notExists', 'contains', 'notContains')
		.updateOps('set', 'inc', 'mul', 'min', 'max', 'unset', 'push', 'pull', 'patch')
		.lifecycle({
			connect: loadFromDisk,
			disconnect: () => persistToDisk(),
		})
		.crud({
			findByPk: (schema, config, pk) => inMemory.crud.findByPk!(schema, config, pk),
			createMany: async (schema, config, data) => {
				const result = await inMemory.crud.createMany!(schema, config, data)
				await persistToDisk()
				return result
			},
			updateByPk: async (schema, config, pk, ops) => {
				const result = await inMemory.crud.updateByPk!(schema, config, pk, ops)
				if (result) await persistToDisk()
				return result
			},
			deleteByPk: async (schema, config, pk) => {
				const result = await inMemory.crud.deleteByPk!(schema, config, pk)
				if (result) await persistToDisk()
				return result
			},
			raw: async () => {
				throw new EquippedError('JSON adapter does not support raw operations', {
					adapter: 'json',
					operation: 'raw',
				})
			},
		})
		.queryable({
			findMany: (schema, config, group, options) => inMemory.queryable.findMany!(schema, config, group, options),
			updateMany: async (schema, config, group, data) => {
				const result = await inMemory.queryable.updateMany!(schema, config, group, data)
				if (result.length) await persistToDisk()
				return result
			},
			deleteMany: async (schema, config, filter) => {
				const result = await inMemory.queryable.deleteMany!(schema, config, filter)
				if (result.length) await persistToDisk()
				return result
			},
			upsertOne: async (schema, config, filter, create, ops) => {
				const result = await inMemory.queryable.upsertOne!(schema, config, filter, create, ops)
				await persistToDisk()
				return result
			},
		})
		.transactional({
			session: async <T>(fn: () => Promise<T>): Promise<T> => inMemory.session(async () => {
					const result = await fn()
					await persistToDisk()
					return result
				}),
		})
		.build()

	return { adapter, stores }
}

if (import.meta.vitest) {
	const { describe, test, expect, beforeEach, afterEach } = import.meta.vitest
	const { FilterGroup } = await import('../../filter')
	const { OrderBy } = await import('../../query')
	const { Schema } = await import('../../schema')
	const { IncOp, PatchOp, PullOp, PushOp } = await import('../../updates')
	const { v } = await import('valleyed')
	const { mkdtemp, rm } = await import('node:fs/promises')
	const { tmpdir } = await import('node:os')
	const { join } = await import('node:path')

	let tmpDir: string
	let filePath: string

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), 'json-adapter-'))
		filePath = join(tmpDir, 'test.json')
	})

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true })
	})

	describe('json adapter — surface parity with in-memory', () => {
		test('CRUD: create, find, update, delete round-trip', async () => {
			const schema = Schema.from('users')
				.pk('id', v.string(), () => 'u')
				.field('name', v.string())
				.field('age', v.number())
				.build()

			const { adapter } = createJsonAdapter({ filePath })
			await adapter.connect()

			const use = adapter.use(schema, { table: 'users' })

			const created = await use.createMany([
				{ id: 'u1', name: 'Alice', age: 30 },
				{ id: 'u2', name: 'Bob', age: 20 },
			])
			expect(created).toHaveLength(2)

			const found = await use.findOne(FilterGroup.create().eq('id', 'u1'))
			expect(found).toEqual({ id: 'u1', name: 'Alice', age: 30 })

			const many = await use.findMany(FilterGroup.create().gt('age', 19), {
				orderBy: [new OrderBy('age', 'asc')],
			})
			expect(many).toEqual([
				{ id: 'u2', name: 'Bob', age: 20 },
				{ id: 'u1', name: 'Alice', age: 30 },
			])

			await use.updateOne(FilterGroup.create().eq('id', 'u1'), { age: 31 })
			const updated = await use.findOne(FilterGroup.create().eq('id', 'u1'))
			expect(updated?.age).toBe(31)

			const deleted = await use.deleteOne(FilterGroup.create().eq('id', 'u2'))
			expect(deleted).toEqual({ id: 'u2', name: 'Bob', age: 20 })

			const remaining = await use.findMany(FilterGroup.create())
			expect(remaining).toHaveLength(1)

			await adapter.disconnect()
		})

		test('supports nested filters, ordering, select, offset and limit', async () => {
			const schema = Schema.from('users')
				.pk('id', v.string(), () => 'u')
				.field('name', v.string())
				.field('age', v.number())
				.build()

			const { adapter } = createJsonAdapter({ filePath })
			await adapter.connect()
			const use = adapter.use(schema, { table: 'users' })

			await use.createMany([
				{ id: 'u1', name: 'Alice', age: 30 },
				{ id: 'u2', name: 'Bob', age: 20 },
				{ id: 'u3', name: 'Carol', age: 40 },
			])

			const builtGroup = FilterGroup.create().and([
				(q) => q.gt('age', 19),
				(q) => q.or([(g) => g.eq('name', 'Alice'), (g) => g.eq('name', 'Carol')]),
			])
			const options = { orderBy: [new OrderBy('age', 'desc')], offset: 1, limit: 1, select: ['id', 'name'] as const }
			const rows = await use.findMany(builtGroup, options)
			expect(rows).toEqual([{ id: 'u1', name: 'Alice' }])

			await adapter.disconnect()
		})

		test('supports update operators and rollback on failed session', async () => {
			const schema = Schema.from('docs')
				.pk('id', v.string(), () => 'd1')
				.field('count', v.number())
				.field('tags', v.array(v.string()))
				.field('meta', v.object({ a: v.number() }))
				.build()

			const { adapter } = createJsonAdapter({ filePath })
			await adapter.connect()
			const use = adapter.use(schema, { table: 'docs' })

			await use.createOne({ id: 'd1', count: 1, tags: ['x'], meta: { a: 1 } })

			await adapter.session(async () => {
				await use.updateOne(FilterGroup.create().eq('id', 'd1'), {
					count: new IncOp('count', 2),
					tags: new PushOp('tags', 'y'),
					meta: new PatchOp('meta', { a: 9 }),
				})
			})

			await expect(
				adapter.session(async () => {
					await use.updateOne(FilterGroup.create().eq('id', 'd1'), { tags: new PullOp('tags', 'x') })
					throw new Error('boom')
				}),
			).rejects.toThrow('boom')

			const row = await use.findOne(FilterGroup.create().eq('id', 'd1'))
			expect(row).toEqual({ id: 'd1', count: 3, tags: ['x', 'y'], meta: { a: 9 } })

			await adapter.disconnect()
		})

		test('upsertOne inserts when missing and updates when existing', async () => {
			const schema = Schema.from('items')
				.pk('id', v.string(), () => 'i')
				.field('val', v.number())
				.build()

			const { adapter } = createJsonAdapter({ filePath })
			await adapter.connect()
			const use = adapter.use(schema, { table: 'items' })

			const inserted = await use.upsertOne(
				FilterGroup.create().eq('id', 'i1'),
				{ id: 'i1', val: 10 },
				[],
			)
			expect(inserted).toEqual({ id: 'i1', val: 10 })

			const updated = await use.upsertOne(
				FilterGroup.create().eq('id', 'i1'),
				{ id: 'i1', val: 10 },
				[new IncOp('val', 5)],
			)
			expect(updated).toEqual({ id: 'i1', val: 15 })

			await adapter.disconnect()
		})
	})

	describe('json adapter — persistence', () => {
		test('state persists across adapter restarts', async () => {
			const schema = Schema.from('users')
				.pk('id', v.string(), () => 'u')
				.field('name', v.string())
				.build()

			const a1 = createJsonAdapter({ filePath })
			await a1.adapter.connect()
			const use1 = a1.adapter.use(schema, { table: 'users' })
			await use1.createMany([
				{ id: 'u1', name: 'Alice' },
				{ id: 'u2', name: 'Bob' },
			])
			await a1.adapter.disconnect()

			const a2 = createJsonAdapter({ filePath })
			await a2.adapter.connect()
			const use2 = a2.adapter.use(schema, { table: 'users' })
			const rows = await use2.findMany(FilterGroup.create())
			expect(rows).toHaveLength(2)
			expect(rows.map((r) => r.name).sort()).toEqual(['Alice', 'Bob'])
			await a2.adapter.disconnect()
		})

		test('failed session does not persist rolled-back state to disk', async () => {
			const schema = Schema.from('docs')
				.pk('id', v.string(), () => 'd')
				.field('val', v.number())
				.build()

			const a1 = createJsonAdapter({ filePath })
			await a1.adapter.connect()
			const use1 = a1.adapter.use(schema, { table: 'docs' })
			await use1.createOne({ id: 'd1', val: 1 })
			await a1.adapter.disconnect()

			const a2 = createJsonAdapter({ filePath })
			await a2.adapter.connect()
			const use2 = a2.adapter.use(schema, { table: 'docs' })
			await expect(
				a2.adapter.session(async () => {
					await use2.updateOne(FilterGroup.create().eq('id', 'd1'), { val: 999 })
					throw new Error('rollback')
				}),
			).rejects.toThrow('rollback')
			await a2.adapter.disconnect()

			const a3 = createJsonAdapter({ filePath })
			await a3.adapter.connect()
			const use3 = a3.adapter.use(schema, { table: 'docs' })
			const row = await use3.findOne(FilterGroup.create().eq('id', 'd1'))
			expect(row?.val).toBe(1)
			await a3.adapter.disconnect()
		})
	})

	describe('json adapter — atomic writes', () => {
		test('file is valid JSON after every write', async () => {
			const { readFile: rf } = await import('node:fs/promises')
			const schema = Schema.from('items')
				.pk('id', v.string(), () => 'i')
				.field('val', v.number())
				.build()

			const { adapter } = createJsonAdapter({ filePath })
			await adapter.connect()
			const use = adapter.use(schema, { table: 'items' })

			for (let i = 0; i < 10; i++) {
				await use.createOne({ id: `i${i}`, val: i })
				const raw = await rf(filePath, 'utf-8')
				expect(() => JSON.parse(raw)).not.toThrow()
			}
			await adapter.disconnect()
		})

		test('no .tmp files remain after writes complete', async () => {
			const { readdir } = await import('node:fs/promises')
			const schema = Schema.from('items')
				.pk('id', v.string(), () => 'i')
				.field('val', v.number())
				.build()

			const { adapter } = createJsonAdapter({ filePath })
			await adapter.connect()
			const use = adapter.use(schema, { table: 'items' })

			for (let i = 0; i < 5; i++) {
				await use.createOne({ id: `i${i}`, val: i })
			}
			await adapter.disconnect()

			const files = await readdir(tmpDir)
			const tmpFiles = files.filter((f) => f.includes('.tmp.'))
			expect(tmpFiles).toHaveLength(0)
		})
	})

	describe('json adapter — concurrent writes serialize', () => {
		test('parallel writes from same process all persist', async () => {
			const schema = Schema.from('items')
				.pk('id', v.string(), () => 'i')
				.field('val', v.number())
				.build()

			const { adapter } = createJsonAdapter({ filePath })
			await adapter.connect()
			const use = adapter.use(schema, { table: 'items' })

			await Promise.all(
				Array.from({ length: 20 }, (_, i) => use.createOne({ id: `i${i}`, val: i })),
			)

			const rows = await use.findMany(FilterGroup.create())
			expect(rows).toHaveLength(20)
			await adapter.disconnect()

			const a2 = createJsonAdapter({ filePath })
			await a2.adapter.connect()
			const use2 = a2.adapter.use(schema, { table: 'items' })
			const reloaded = await use2.findMany(FilterGroup.create())
			expect(reloaded).toHaveLength(20)
			await a2.adapter.disconnect()
		})
	})
}
