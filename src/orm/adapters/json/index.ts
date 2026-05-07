import { readFile, rename, writeFile } from 'node:fs/promises'

import { v } from 'valleyed'

import { configurable } from '../../../utilities/configurable'
import type { FilterGroup } from '../../filter'
import { OrmAdapter, type AggregateSpec } from '../../orm-adapter'
import type { QueryOptions } from '../../query'
import type { AnySchema } from '../../schema'
import type { AnyUpdateOp } from '../../updates'
import { InMemoryAdapter, type InMemoryRepoConfig } from '../in-memory'

export type JsonAdapterConfig = InMemoryRepoConfig

const jsonConnectionPipe = () =>
	v.object({
		filePath: v.string(),
	})

export class JsonAdapter extends configurable(jsonConnectionPipe, OrmAdapter) {
	readonly schemaConfigPipe = v.object({ table: v.string() })

	readonly #inMemory = InMemoryAdapter.create({})

	readonly supportedFieldTypes = this.#inMemory.supportedFieldTypes
	readonly queryableOps = this.#inMemory.queryableOps
	readonly updateOps = this.#inMemory.updateOps
	readonly aggregateOps = this.#inMemory.aggregateOps

	#writeQueue: Promise<void> = Promise.resolve()

	protected constructor(config: typeof JsonAdapter.Config) {
		super(config)
	}

	get stores() {
		return this.#inMemory.stores
	}

	#serializeStores(): string {
		const obj: Record<string, Record<string, Record<string, unknown>>> = {}
		for (const [name, store] of this.stores.entries()) {
			const records: Record<string, Record<string, unknown>> = {}
			for (const [pk, doc] of store.entries()) {
				records[pk] = doc
			}
			obj[name] = records
		}
		return JSON.stringify(obj)
	}

	async #atomicWrite(): Promise<void> {
		const data = this.#serializeStores()
		const tmpPath = this.config.filePath + '.tmp.' + process.pid + '.' + Date.now()
		await writeFile(tmpPath, data, 'utf-8')
		await rename(tmpPath, this.config.filePath)
	}

	#persistToDisk(): Promise<void> {
		const next = this.#writeQueue.then(() => this.#atomicWrite())
		this.#writeQueue = next.catch(() => {})
		return next
	}

	async connect(): Promise<void> {
		let raw: string
		try {
			raw = await readFile(this.config.filePath, 'utf-8')
		} catch {
			return
		}
		const data = JSON.parse(raw) as Record<string, Record<string, Record<string, unknown>>>
		this.stores.clear()
		for (const [name, records] of Object.entries(data)) {
			const store = new Map<string, Record<string, unknown>>()
			for (const [pk, doc] of Object.entries(records)) {
				store.set(pk, doc)
			}
			this.stores.set(name, store)
		}
	}

	async disconnect(): Promise<void> {
		await this.#persistToDisk()
	}

	async findByPk(schema: AnySchema, config: unknown, pk: unknown) {
		return this.#inMemory.findByPk(schema, config, pk)
	}

	async createMany(schema: AnySchema, config: unknown, data: Record<string, unknown>[]) {
		const result = await this.#inMemory.createMany(schema, config, data)
		await this.#persistToDisk()
		return result
	}

	async updateByPk(schema: AnySchema, config: unknown, pk: unknown, ops: AnyUpdateOp[]) {
		const result = await this.#inMemory.updateByPk(schema, config, pk, ops)
		if (result) await this.#persistToDisk()
		return result
	}

	async deleteByPk(schema: AnySchema, config: unknown, pk: unknown) {
		const result = await this.#inMemory.deleteByPk(schema, config, pk)
		if (result) await this.#persistToDisk()
		return result
	}

	async findMany(schema: AnySchema, config: unknown, group: FilterGroup, options?: QueryOptions) {
		return this.#inMemory.findMany(schema, config, group, options)
	}

	async updateMany(schema: AnySchema, config: unknown, group: FilterGroup, data: Record<string, unknown>) {
		const result = await this.#inMemory.updateMany(schema, config, group, data)
		if (result.length) await this.#persistToDisk()
		return result
	}

	async deleteMany(schema: AnySchema, config: unknown, filter: FilterGroup) {
		const result = await this.#inMemory.deleteMany(schema, config, filter)
		if (result.length) await this.#persistToDisk()
		return result
	}

	async upsertOne(schema: AnySchema, config: unknown, filter: FilterGroup, create: Record<string, unknown>, ops: AnyUpdateOp[]) {
		const result = await this.#inMemory.upsertOne(schema, config, filter, create, ops)
		await this.#persistToDisk()
		return result
	}

	async aggregate(schema: AnySchema, config: unknown, spec: AggregateSpec) {
		return this.#inMemory.aggregate(schema, config, spec)
	}

	async session<T>(fn: () => Promise<T>): Promise<T> {
		return this.#inMemory.session(async () => {
			const result = await fn()
			await this.#persistToDisk()
			return result
		})
	}
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

	describe('json adapter — class construction', () => {
		test('JsonAdapter.create({ filePath }) produces a working adapter', () => {
			const adapter = JsonAdapter.create({ filePath })
			expect(adapter).toBeInstanceOf(JsonAdapter)
			expect(adapter.schemaConfigPipe).toBeDefined()
			expect(adapter.supportedFieldTypes).toEqual(['string', 'number', 'boolean', 'null', 'object', 'array', 'date'])
		})

		test('auto-wired Instance hooks register connect/disconnect keyed by class', async () => {
			const { Instance: Inst } = await import('../../../instance')
			const onSpy = (await import('vitest')).vi.spyOn(Inst, 'on').mockImplementation(() => {})

			JsonAdapter.create({ filePath })

			expect(onSpy).toHaveBeenCalledWith('start', expect.any(Function), expect.objectContaining({ class: JsonAdapter }))
			expect(onSpy).toHaveBeenCalledWith('close', expect.any(Function), expect.objectContaining({ class: JsonAdapter }))

			onSpy.mockRestore()
		})
	})

	describe('json adapter — surface parity with in-memory', () => {
		test('CRUD: create, find, update, delete round-trip', async () => {
			const schema = Schema.from('users')
				.pk('id', v.string(), () => 'u')
				.field('name', v.string())
				.field('age', v.number())
				.build()

			const adapter = JsonAdapter.create({ filePath })
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

			const adapter = JsonAdapter.create({ filePath })
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

			const adapter = JsonAdapter.create({ filePath })
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

			const adapter = JsonAdapter.create({ filePath })
			await adapter.connect()
			const use = adapter.use(schema, { table: 'items' })

			const inserted = await use.upsertOne(FilterGroup.create().eq('id', 'i1'), { id: 'i1', val: 10 }, [])
			expect(inserted).toEqual({ id: 'i1', val: 10 })

			const updated = await use.upsertOne(FilterGroup.create().eq('id', 'i1'), { id: 'i1', val: 10 }, [new IncOp('val', 5)])
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

			const a1 = JsonAdapter.create({ filePath })
			await a1.connect()
			const use1 = a1.use(schema, { table: 'users' })
			await use1.createMany([
				{ id: 'u1', name: 'Alice' },
				{ id: 'u2', name: 'Bob' },
			])
			await a1.disconnect()

			const a2 = JsonAdapter.create({ filePath })
			await a2.connect()
			const use2 = a2.use(schema, { table: 'users' })
			const rows = await use2.findMany(FilterGroup.create())
			expect(rows).toHaveLength(2)
			expect(rows.map((r) => r.name).sort()).toEqual(['Alice', 'Bob'])
			await a2.disconnect()
		})

		test('failed session does not persist rolled-back state to disk', async () => {
			const schema = Schema.from('docs')
				.pk('id', v.string(), () => 'd')
				.field('val', v.number())
				.build()

			const a1 = JsonAdapter.create({ filePath })
			await a1.connect()
			const use1 = a1.use(schema, { table: 'docs' })
			await use1.createOne({ id: 'd1', val: 1 })
			await a1.disconnect()

			const a2 = JsonAdapter.create({ filePath })
			await a2.connect()
			const use2 = a2.use(schema, { table: 'docs' })
			await expect(
				a2.session(async () => {
					await use2.updateOne(FilterGroup.create().eq('id', 'd1'), { val: 999 })
					throw new Error('rollback')
				}),
			).rejects.toThrow('rollback')
			await a2.disconnect()

			const a3 = JsonAdapter.create({ filePath })
			await a3.connect()
			const use3 = a3.use(schema, { table: 'docs' })
			const row = await use3.findOne(FilterGroup.create().eq('id', 'd1'))
			expect(row?.val).toBe(1)
			await a3.disconnect()
		})
	})

	describe('json adapter — atomic writes', () => {
		test('file is valid JSON after every write', async () => {
			const { readFile: rf } = await import('node:fs/promises')
			const schema = Schema.from('items')
				.pk('id', v.string(), () => 'i')
				.field('val', v.number())
				.build()

			const adapter = JsonAdapter.create({ filePath })
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

			const adapter = JsonAdapter.create({ filePath })
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

	describe('json adapter — aggregate delegation', () => {
		test('aggregateOps matches in-memory adapter', () => {
			const json = JsonAdapter.create({ filePath })
			const inMem = InMemoryAdapter.create({})
			expect(json.aggregateOps).toEqual(inMem.aggregateOps)
			expect(json.aggregateOps).toEqual(['count', 'countDistinct', 'sum', 'avg', 'min', 'max'])
		})

		test('count returns identical result to in-memory', async () => {
			const schema = Schema.from('orders')
				.pk('id', v.string(), () => 'o')
				.field('amount', v.number())
				.field('region', v.string())
				.build()

			const adapter = JsonAdapter.create({ filePath })
			await adapter.connect()
			const use = adapter.use(schema, { table: 'orders' })

			await use.createMany([
				{ id: 'o1', amount: 100, region: 'us' },
				{ id: 'o2', amount: 200, region: 'eu' },
				{ id: 'o3', amount: 150, region: 'us' },
			])

			const spec: AggregateSpec = {
				aggregates: [{ fn: 'count', alias: 'total' }],
				groupBy: [],
			}
			const result = await adapter.aggregate(schema, { table: 'orders' }, spec)
			expect(result).toEqual([{ total: 3 }])

			await adapter.disconnect()
		})

		test('countDistinct returns identical result to in-memory', async () => {
			const schema = Schema.from('orders')
				.pk('id', v.string(), () => 'o')
				.field('amount', v.number())
				.field('region', v.string())
				.build()

			const adapter = JsonAdapter.create({ filePath })
			await adapter.connect()
			const use = adapter.use(schema, { table: 'orders' })

			await use.createMany([
				{ id: 'o1', amount: 100, region: 'us' },
				{ id: 'o2', amount: 200, region: 'eu' },
				{ id: 'o3', amount: 150, region: 'us' },
			])

			const spec: AggregateSpec = {
				aggregates: [{ fn: 'countDistinct', field: 'region', alias: 'uniqueRegions' }],
				groupBy: [],
			}
			const result = await adapter.aggregate(schema, { table: 'orders' }, spec)
			expect(result).toEqual([{ uniqueRegions: 2 }])

			await adapter.disconnect()
		})

		test('sum, avg, min, max return identical results to in-memory', async () => {
			const schema = Schema.from('orders')
				.pk('id', v.string(), () => 'o')
				.field('amount', v.number())
				.field('region', v.string())
				.build()

			const adapter = JsonAdapter.create({ filePath })
			await adapter.connect()
			const use = adapter.use(schema, { table: 'orders' })

			await use.createMany([
				{ id: 'o1', amount: 100, region: 'us' },
				{ id: 'o2', amount: 200, region: 'eu' },
				{ id: 'o3', amount: 150, region: 'us' },
			])

			const spec: AggregateSpec = {
				aggregates: [
					{ fn: 'sum', field: 'amount', alias: 'totalAmount' },
					{ fn: 'avg', field: 'amount', alias: 'avgAmount' },
					{ fn: 'min', field: 'amount', alias: 'minAmount' },
					{ fn: 'max', field: 'amount', alias: 'maxAmount' },
				],
				groupBy: [],
			}
			const result = await adapter.aggregate(schema, { table: 'orders' }, spec)
			expect(result).toEqual([{ totalAmount: 450, avgAmount: 150, minAmount: 100, maxAmount: 200 }])

			await adapter.disconnect()
		})

		test('groupBy returns identical results to in-memory', async () => {
			const schema = Schema.from('orders')
				.pk('id', v.string(), () => 'o')
				.field('amount', v.number())
				.field('region', v.string())
				.build()

			const adapter = JsonAdapter.create({ filePath })
			await adapter.connect()
			const use = adapter.use(schema, { table: 'orders' })

			await use.createMany([
				{ id: 'o1', amount: 100, region: 'us' },
				{ id: 'o2', amount: 200, region: 'eu' },
				{ id: 'o3', amount: 150, region: 'us' },
			])

			const spec: AggregateSpec = {
				aggregates: [
					{ fn: 'count', alias: 'cnt' },
					{ fn: 'sum', field: 'amount', alias: 'total' },
				],
				groupBy: ['region'],
			}
			const result = await adapter.aggregate(schema, { table: 'orders' }, spec)
			const sorted = result.sort((a, b) => String(a.region).localeCompare(String(b.region)))
			expect(sorted).toEqual([
				{ region: 'eu', cnt: 1, total: 200 },
				{ region: 'us', cnt: 2, total: 250 },
			])

			await adapter.disconnect()
		})

		test('where pre-filter returns identical results to in-memory', async () => {
			const schema = Schema.from('orders')
				.pk('id', v.string(), () => 'o')
				.field('amount', v.number())
				.field('region', v.string())
				.build()

			const adapter = JsonAdapter.create({ filePath })
			await adapter.connect()
			const use = adapter.use(schema, { table: 'orders' })

			await use.createMany([
				{ id: 'o1', amount: 100, region: 'us' },
				{ id: 'o2', amount: 200, region: 'eu' },
				{ id: 'o3', amount: 150, region: 'us' },
			])

			const spec: AggregateSpec = {
				where: FilterGroup.create().gt('amount', 100),
				aggregates: [{ fn: 'count', alias: 'cnt' }],
				groupBy: [],
			}
			const result = await adapter.aggregate(schema, { table: 'orders' }, spec)
			expect(result).toEqual([{ cnt: 2 }])

			await adapter.disconnect()
		})

		test('having post-filter returns identical results to in-memory', async () => {
			const schema = Schema.from('orders')
				.pk('id', v.string(), () => 'o')
				.field('amount', v.number())
				.field('region', v.string())
				.build()

			const adapter = JsonAdapter.create({ filePath })
			await adapter.connect()
			const use = adapter.use(schema, { table: 'orders' })

			await use.createMany([
				{ id: 'o1', amount: 100, region: 'us' },
				{ id: 'o2', amount: 200, region: 'eu' },
				{ id: 'o3', amount: 150, region: 'us' },
			])

			const spec: AggregateSpec = {
				aggregates: [{ fn: 'count', alias: 'cnt' }],
				groupBy: ['region'],
				having: FilterGroup.create().gt('cnt', 1),
			}
			const result = await adapter.aggregate(schema, { table: 'orders' }, spec)
			expect(result).toEqual([{ region: 'us', cnt: 2 }])

			await adapter.disconnect()
		})

		test('aggregate delegates to same in-memory instance used by CRUD', async () => {
			const schema = Schema.from('items')
				.pk('id', v.string(), () => 'i')
				.field('val', v.number())
				.build()

			const adapter = JsonAdapter.create({ filePath })
			await adapter.connect()
			const use = adapter.use(schema, { table: 'items' })

			await use.createMany([
				{ id: 'i1', val: 10 },
				{ id: 'i2', val: 20 },
			])

			const spec: AggregateSpec = {
				aggregates: [{ fn: 'sum', field: 'val', alias: 'total' }],
				groupBy: [],
			}
			const result = await adapter.aggregate(schema, { table: 'items' }, spec)
			expect(result).toEqual([{ total: 30 }])

			await use.createOne({ id: 'i3', val: 30 })
			const result2 = await adapter.aggregate(schema, { table: 'items' }, spec)
			expect(result2).toEqual([{ total: 60 }])

			await adapter.disconnect()
		})
	})

	describe('json adapter — concurrent writes serialize', () => {
		test('parallel writes from same process all persist', async () => {
			const schema = Schema.from('items')
				.pk('id', v.string(), () => 'i')
				.field('val', v.number())
				.build()

			const adapter = JsonAdapter.create({ filePath })
			await adapter.connect()
			const use = adapter.use(schema, { table: 'items' })

			await Promise.all(Array.from({ length: 20 }, (_, i) => use.createOne({ id: `i${i}`, val: i })))

			const rows = await use.findMany(FilterGroup.create())
			expect(rows).toHaveLength(20)
			await adapter.disconnect()

			const a2 = JsonAdapter.create({ filePath })
			await a2.connect()
			const use2 = a2.use(schema, { table: 'items' })
			const reloaded = await use2.findMany(FilterGroup.create())
			expect(reloaded).toHaveLength(20)
			await a2.disconnect()
		})
	})
}
