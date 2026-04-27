import { AsyncLocalStorage } from 'node:async_hooks'

import { differ } from 'valleyed'

import { EquippedError } from '../../../errors'
import { QueryGroup, Where, WhereBlockOp, WhereOp, type FilterOp, type QueryOptions, type QuerySpec } from '../../query'
import type { AnySchema } from '../../schema'
import { IncOp, MaxOp, MinOp, MulOp, PatchOp, PullOp, PushOp, UnsetOp } from '../../updates'
import { OrmAdapter, type OrmUse } from '../base'

export type InMemoryRepoConfig = {
	table?: string
	collection?: string
	col?: string
	name?: string
	prefix?: string
}

function clone<T>(value: T): T {
	return structuredClone(value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function containsSubset(source: unknown, needle: unknown): boolean {
	if (Array.isArray(source)) {
		const wanted = Array.isArray(needle) ? needle : [needle]
		return wanted.every((item) => source.some((existing) => differ.equal(existing, item)))
	}

	if (isPlainObject(source) && isPlainObject(needle)) {
		return Object.entries(needle).every(([k, v]) => containsSubset(source[k], v))
	}

	return differ.equal(source, needle)
}

function compareValues(a: unknown, b: unknown): number {
	if (a === b) return 0
	if (a == null) return -1
	if (b == null) return 1
	if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : 1
	if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : 1
	if (typeof a === 'boolean' && typeof b === 'boolean') return a === false ? -1 : 1
	const sa = JSON.stringify(a)
	const sb = JSON.stringify(b)
	if (sa === sb) return 0
	return sa < sb ? -1 : 1
}

function resolveConfigName(schema: AnySchema, config: InMemoryRepoConfig): string {
	return config.table ?? config.collection ?? config.col ?? config.name ?? config.prefix ?? schema.name
}

function setByPath(obj: Record<string, unknown>, path: readonly string[], value: unknown): void {
	if (path.length === 0) return
	let current: Record<string, unknown> = obj
	for (let i = 0; i < path.length - 1; i++) {
		const key = path[i]
		if (!isPlainObject(current[key])) current[key] = {}
		current = current[key] as Record<string, unknown>
	}
	current[path[path.length - 1]] = value
}

function evaluateWhere(doc: Record<string, unknown>, where: Where): boolean {
	const fieldValue = doc[where.field]
	const value = where.value

	switch (where.op) {
		case WhereOp.eq:
			return differ.equal(fieldValue, value)
		case WhereOp.ne:
			return !differ.equal(fieldValue, value)
		case WhereOp.gt:
			return compareValues(fieldValue, value) > 0
		case WhereOp.gte:
			return compareValues(fieldValue, value) >= 0
		case WhereOp.lt:
			return compareValues(fieldValue, value) < 0
		case WhereOp.lte:
			return compareValues(fieldValue, value) <= 0
		case WhereOp.in: {
			if (!Array.isArray(value)) return false
			return value.some((v) => differ.equal(fieldValue, v))
		}
		case WhereOp.nin: {
			if (!Array.isArray(value)) return true
			return !value.some((v) => differ.equal(fieldValue, v))
		}
		case WhereOp.like:
			return String(fieldValue ?? '')
				.toLowerCase()
				.includes(String(value ?? '').toLowerCase())
		case WhereOp.exists:
			return value ? fieldValue != null : fieldValue == null
		case WhereOp.contains:
			return containsSubset(fieldValue, value)
		case WhereOp.notContains:
			return !containsSubset(fieldValue, value)
		default:
			return false
	}
}

function evaluateOp(doc: Record<string, unknown>, op: FilterOp): boolean {
	if (op instanceof Where) return evaluateWhere(doc, op)
	if (op instanceof QueryGroup) {
		if (op.op == null) return op.children.every((c) => evaluateOp(doc, c))
		if (op.op === WhereBlockOp.and) return op.children.every((c) => evaluateOp(doc, c))
		if (op.op === WhereBlockOp.or) return op.children.some((c) => evaluateOp(doc, c))
	}
	return true
}

function matchesFilter(doc: Record<string, unknown>, filter: QuerySpec): boolean {
	for (const clause of filter.clauses) {
		if (!evaluateOp(doc, clause)) return false
	}
	return true
}

function applyOptions(rows: Record<string, unknown>[], options?: QueryOptions): Record<string, unknown>[] {
	let results = rows

	if (options?.orderBy?.length) {
		results = [...results].sort((a, b) => {
			for (const ord of options.orderBy ?? []) {
				const cmp = compareValues(a[ord.field], b[ord.field])
				if (cmp !== 0) return ord.direction === 'asc' ? cmp : -cmp
			}
			return 0
		})
	}

	if (options?.offset != null) {
		results = results.slice(Math.max(0, options.offset))
	}

	if (options?.limit != null) {
		results = results.slice(0, options.limit)
	}

	if (options?.select?.length) {
		const fields = new Set<string>(options.select)
		results = results.map((row) => {
			const out: Record<string, unknown> = {}
			for (const key of fields) out[key] = row[key]
			return out
		})
	}

	return results
}

function applyUpdateOp(current: Record<string, unknown>, key: string, value: unknown) {
	if (value instanceof IncOp) {
		const base = Number(current[key] ?? 0)
		current[key] = base + value.by
		return
	}
	if (value instanceof MulOp) {
		const base = Number(current[key] ?? 0)
		current[key] = base * value.by
		return
	}
	if (value instanceof MinOp) {
		const base = current[key]
		current[key] = base == null || compareValues(value.value, base) < 0 ? value.value : base
		return
	}
	if (value instanceof MaxOp) {
		const base = current[key]
		current[key] = base == null || compareValues(value.value, base) > 0 ? value.value : base
		return
	}
	if (value instanceof UnsetOp) {
		current[key] = null
		return
	}
	if (value instanceof PushOp) {
		const arr = Array.isArray(current[key]) ? [...(current[key] as unknown[])] : []
		arr.push(clone(value.value))
		current[key] = arr
		return
	}
	if (value instanceof PullOp) {
		const arr = Array.isArray(current[key]) ? (current[key] as unknown[]) : []
		current[key] = arr.filter((entry) => !differ.equal(entry, value.value))
		return
	}
	if (value instanceof PatchOp) {
		const target = isPlainObject(current[key]) ? clone(current[key] as Record<string, unknown>) : {}
		setByPath(target, value.path, clone(value.value))
		current[key] = target
		return
	}
	current[key] = clone(value)
}

function applyUpdateData(doc: Record<string, unknown>, data: Record<string, unknown>): Record<string, unknown> {
	const updated = clone(doc)
	for (const [key, value] of Object.entries(data)) {
		applyUpdateOp(updated, key, value)
	}
	return updated
}

const sessionActiveStore = new AsyncLocalStorage<boolean>()

export class InMemoryOrm extends OrmAdapter<InMemoryRepoConfig> {
	readonly stores = new Map<string, Map<string, Record<string, unknown>>>()

	async connect() {}
	async disconnect() {}

	#snapshot() {
		const snap = new Map<string, Map<string, Record<string, unknown>>>()
		for (const [name, store] of this.stores.entries()) {
			const storeCopy = new Map<string, Record<string, unknown>>()
			for (const [id, doc] of store.entries()) {
				storeCopy.set(id, clone(doc))
			}
			snap.set(name, storeCopy)
		}
		return snap
	}

	#restore(snapshot: Map<string, Map<string, Record<string, unknown>>>) {
		this.stores.clear()
		for (const [name, store] of snapshot.entries()) {
			this.stores.set(name, store)
		}
	}

	#getStore(name: string) {
		if (!this.stores.has(name)) this.stores.set(name, new Map())
		return this.stores.get(name)!
	}

	use(schema: AnySchema, config: InMemoryRepoConfig): OrmUse {
		const storeName = resolveConfigName(schema, config)
		const getStore = () => this.#getStore(storeName)
		const pk = schema.pkField.name

		const use: OrmUse = {
			findMany: async (filter, options) => {
				const rows = [...getStore().values()].filter((doc) => matchesFilter(doc, filter)).map((doc) => clone(doc))
				return applyOptions(rows, options)
			},
			findOne: async (filter) => {
				const rows = await use.findMany(filter, { limit: 1 })
				return rows[0] ?? null
			},
			insertOne: async (data) => {
				const row = clone(data)
				getStore().set(String(row[pk]), row)
				return clone(row)
			},
			insertMany: async (data) => Promise.all(data.map((d) => use.insertOne(d))),
			updateMany: async (filter, data) => {
				const store = getStore()
				const ids = [...store.entries()].filter(([, doc]) => matchesFilter(doc, filter)).map(([id]) => id)

				const updated: Record<string, unknown>[] = []
				for (const id of ids) {
					const current = store.get(id)
					if (!current) continue
					const next = applyUpdateData(current, data)
					store.set(id, next)
					updated.push(clone(next))
				}
				return updated
			},
			updateOne: async (filter, data) => {
				const rows = await use.updateMany(filter, data)
				return rows[0] ?? null
			},
			upsertOne: async (filter, data) => {
				const current = await use.findOne(filter)
				if (current) {
					const updateData = 'update' in data ? data.update : data.insert
					const next = applyUpdateData(current, updateData)
					getStore().set(String(next[pk]), next)
					return clone(next)
				}
				return use.insertOne(data.insert)
			},
			deleteOne: async (filter) => {
				const row = await use.findOne(filter)
				if (!row) return null
				getStore().delete(String(row[pk]))
				return row
			},
			deleteMany: async (filter) => {
				const rows = await use.findMany(filter)
				for (const row of rows) {
					getStore().delete(String(row[pk]))
				}
				return rows
			},
			raw: async () => {
				throw new EquippedError('In-memory adapter does not support raw operations', {
					adapter: 'in-memory',
					operation: 'raw',
				})
			},
		}

		return use
	}

	async session<T>(fn: () => Promise<T>): Promise<T> {
		if (sessionActiveStore.getStore()) return fn()
		const snapshot = this.#snapshot()
		try {
			return await sessionActiveStore.run(true, fn)
		} catch (error) {
			this.#restore(snapshot)
			throw error
		}
	}
}

if (import.meta.vitest) {
	const { describe, test, expect } = import.meta.vitest
	const { Query } = await import('../../query')
	const { Schema } = await import('../../schema')
	const { inc, patch, pull, push } = await import('../../updates')

	describe('in-memory adapter', () => {
		test('supports nested filters, ordering, select, offset and limit', async () => {
			const schema = Schema.from('users')
				.pk('id', (await import('valleyed')).v.string(), () => 'u')
				.field('name', (await import('valleyed')).v.string())
				.field('age', (await import('valleyed')).v.number())
			const orm = new InMemoryOrm()
			const use = orm.use(schema, { table: 'users' })
			await use.insertMany([
				{ id: 'u1', name: 'Alice', age: 30 },
				{ id: 'u2', name: 'Bob', age: 20 },
				{ id: 'u3', name: 'Carol', age: 40 },
			])
			const built = Query.from()
				.and((q) => q.gt('age', 19).or((nested) => nested.eq('name', 'Alice').eq('name', 'Carol')))
				.orderBy('age', 'desc')
				.offset(1)
				.limit(1)
			const rows = await use.findMany(built.toQuerySpec(), { ...built.toOptions(), select: ['id', 'name'] })
			expect(rows).toEqual([{ id: 'u1', name: 'Alice' }])
		})

		test('supports update operators and rollback on failed session', async () => {
			const v = (await import('valleyed')).v
			const schema = Schema.from('docs')
				.pk('id', v.string(), () => 'd1')
				.field('count', v.number())
				.field('tags', v.array(v.string()))
				.field('meta', v.object({ a: v.number() }))
			const orm = new InMemoryOrm()
			const use = orm.use(schema, { table: 'docs' })
			await use.insertOne({ id: 'd1', count: 1, tags: ['x'], meta: { a: 1 } })

			await orm.session(async () => {
				await use.updateOne(Query.from().eq('id', 'd1').toQuerySpec(), {
					count: inc(2),
					tags: push('y'),
					meta: patch(['a'], 9),
				})
			})

			await expect(
				orm.session(async () => {
					await use.updateOne(Query.from().eq('id', 'd1').toQuerySpec(), { tags: pull('x') })
					throw new Error('boom')
				}),
			).rejects.toThrow('boom')

			const row = await use.findOne(Query.from().eq('id', 'd1').toQuerySpec())
			expect(row).toEqual({ id: 'd1', count: 3, tags: ['x', 'y'], meta: { a: 9 } })
		})
	})
}
