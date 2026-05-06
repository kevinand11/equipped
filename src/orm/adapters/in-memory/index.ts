import { AsyncLocalStorage } from 'node:async_hooks'

import { differ } from 'valleyed'

import { Adapter } from '../../adapter'
import { Filter, FilterGroup, type FilterChild } from '../../filter'
import type { QueryOptions } from '../../query'
import type { AnySchema } from '../../schema'
import { IncOp, MaxOp, MinOp, MulOp, PatchOp, PullOp, PushOp, SetOp, UnsetOp, type AnyUpdateOp } from '../../updates'

export type InMemoryRepoConfig = {
	table: string
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

function resolveConfigName(_: AnySchema, config: InMemoryRepoConfig): string {
	return `${config.prefix ?? ''}${config.table}`
}

function evaluateFilter(doc: Record<string, unknown>, filter: Filter): boolean {
	const fieldValue = doc[filter.field]
	const value = filter.value

	switch (filter.op) {
		case 'eq':
			return differ.equal(fieldValue, value)
		case 'ne':
			return !differ.equal(fieldValue, value)
		case 'gt':
			return compareValues(fieldValue, value) > 0
		case 'gte':
			return compareValues(fieldValue, value) >= 0
		case 'lt':
			return compareValues(fieldValue, value) < 0
		case 'lte':
			return compareValues(fieldValue, value) <= 0
		case 'in': {
			if (!Array.isArray(value)) return false
			return value.some((v) => differ.equal(fieldValue, v))
		}
		case 'notIn': {
			if (!Array.isArray(value)) return true
			return !value.some((v) => differ.equal(fieldValue, v))
		}
		case 'like':
			return String(fieldValue ?? '')
				.toLowerCase()
				.includes(String(value ?? '').toLowerCase())
		case 'exists':
			return fieldValue != null
		case 'notExists':
			return fieldValue == null
		case 'contains':
			return containsSubset(fieldValue, value)
		case 'notContains':
			return !containsSubset(fieldValue, value)
		default:
			return false
	}
}

function evaluateChild(doc: Record<string, unknown>, child: FilterChild): boolean {
	if (child instanceof Filter) return evaluateFilter(doc, child)
	if (child instanceof FilterGroup) {
		if (child.op === 'and') return child.children.every((c) => evaluateChild(doc, c))
		if (child.op === 'or') return child.children.some((c) => evaluateChild(doc, c))
	}
	return true
}

function matchesFilter(doc: Record<string, unknown>, group: FilterGroup): boolean {
	for (const clause of group.children) {
		if (!evaluateChild(doc, clause)) return false
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
		current[key] = base + value.value
		return
	}
	if (value instanceof MulOp) {
		const base = Number(current[key] ?? 0)
		current[key] = base * value.value
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
		if (isPlainObject(value.value)) {
			for (const [k, v] of Object.entries(value.value as Record<string, unknown>)) {
				target[k] = clone(v)
			}
		}
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

function applyOps(doc: Record<string, unknown>, ops: AnyUpdateOp[]): Record<string, unknown> {
	const updated = clone(doc)
	for (const op of ops) {
		if (op instanceof SetOp) {
			for (const [key, value] of Object.entries(op.values)) {
				updated[key] = clone(value)
			}
		} else {
			applyUpdateOp(updated, op.field, op)
		}
	}
	return updated
}

const sessionActiveStore = new AsyncLocalStorage<boolean>()

export function createInMemoryAdapter() {
	const stores = new Map<string, Map<string, Record<string, unknown>>>()

	function snapshot() {
		const snap = new Map<string, Map<string, Record<string, unknown>>>()
		for (const [name, store] of stores.entries()) {
			const storeCopy = new Map<string, Record<string, unknown>>()
			for (const [id, doc] of store.entries()) {
				storeCopy.set(id, clone(doc))
			}
			snap.set(name, storeCopy)
		}
		return snap
	}

	function restore(snap: Map<string, Map<string, Record<string, unknown>>>) {
		stores.clear()
		for (const [name, store] of snap.entries()) {
			stores.set(name, store)
		}
	}

	function getStore(name: string) {
		if (!stores.has(name)) stores.set(name, new Map())
		return stores.get(name)!
	}

	const adapter = Adapter.from<InMemoryRepoConfig>()
		.supportedFieldTypes('string', 'number', 'boolean', 'null', 'object', 'array', 'date')
		.queryableOps('eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'like', 'exists', 'notExists', 'contains', 'notContains')
		.updateOps('set', 'inc', 'mul', 'min', 'max', 'unset', 'push', 'pull', 'patch')
		.crud({
			findByPk: async (schema, config, pk) => {
				const store = getStore(resolveConfigName(schema, config))
				const doc = store.get(String(pk))
				return doc ? clone(doc) : null
			},
			createMany: async (schema, config, data) => {
				const pk = schema.pkField.name
				const store = getStore(resolveConfigName(schema, config))
				return data.map((d) => {
					const row = clone(d)
					store.set(String(row[pk]), row)
					return clone(row)
				})
			},
			deleteByPk: async (schema, config, pk) => {
				const store = getStore(resolveConfigName(schema, config))
				const pkStr = String(pk)
				const doc = store.get(pkStr)
				if (!doc) return null
				store.delete(pkStr)
				return clone(doc)
			},
			updateByPk: async (schema, config, pk, ops) => {
				const store = getStore(resolveConfigName(schema, config))
				const pkStr = String(pk)
				const doc = store.get(pkStr)
				if (!doc) return null
				const updated = applyOps(doc, ops)
				store.set(pkStr, updated)
				return clone(updated)
			},
		})
		.queryable({
			findMany: async (schema, config, group, options) => {
				const store = getStore(resolveConfigName(schema, config))
				const rows = [...store.values()].filter((doc) => matchesFilter(doc, group)).map((doc) => clone(doc))
				return applyOptions(rows, options)
			},
			updateMany: async (schema, config, group, data) => {
				const store = getStore(resolveConfigName(schema, config))
				const ids = [...store.entries()].filter(([, doc]) => matchesFilter(doc, group)).map(([id]) => id)

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
			deleteMany: async (schema, config, filter) => {
				const store = getStore(resolveConfigName(schema, config))
				const pk = schema.pkField.name
				const rows = [...store.values()].filter((doc) => matchesFilter(doc, filter)).map((doc) => clone(doc))
				for (const row of rows) store.delete(String(row[pk]))
				return rows
			},
			upsertOne: async (schema, config, filter, create, ops) => {
				const store = getStore(resolveConfigName(schema, config))
				const pk = schema.pkField.name
				const rows = [...store.values()].filter((doc) => matchesFilter(doc, filter))
				const current = rows[0]
				if (current) {
					const next = ops.length > 0 ? applyOps(current, ops) : clone(current)
					store.set(String(next[pk]), next)
					return clone(next)
				}
				const base = clone(create)
				const result = ops.length > 0 ? applyOps(base, ops) : base
				store.set(String(result[pk]), result)
				return clone(result)
			},
		})
		.transactional({
			session: async <T>(fn: () => Promise<T>): Promise<T> => {
				if (sessionActiveStore.getStore()) return fn()
				const snap = snapshot()
				try {
					return await sessionActiveStore.run(true, fn)
				} catch (error) {
					restore(snap)
					throw error
				}
			},
		})
		.build()

	return { adapter, stores }
}

if (import.meta.vitest) {
	const { describe, test, expect } = import.meta.vitest
	const { FilterGroup } = await import('../../filter')
	const { OrderBy } = await import('../../query')
	const { Schema } = await import('../../schema')
	const { IncOp, PatchOp, PullOp, PushOp } = await import('../../updates')

	const { v } = await import('valleyed')

	describe('in-memory adapter', () => {
		test('supports nested filters, ordering, select, offset and limit', async () => {
			const schema = Schema.from('users')
				.pk('id', v.string(), () => 'u')
				.field('name', v.string())
				.field('age', v.number())
				.build()
			const { adapter } = createInMemoryAdapter()
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
			const options = { orderBy: [new OrderBy('age', 'desc')], offset: 1, limit: 1, select: ['id', 'name'] }
			const rows = await use.findMany(builtGroup, options)
			expect(rows).toEqual([{ id: 'u1', name: 'Alice' }])
		})

		test('supports update operators and rollback on failed session', async () => {
			const schema = Schema.from('docs')
				.pk('id', v.string(), () => 'd1')
				.field('count', v.number())
				.field('tags', v.array(v.string()))
				.field('meta', v.object({ a: v.number() }))
				.build()
			const { adapter } = createInMemoryAdapter()
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
		})

		test('notIn filter excludes matching values', async () => {
			const schema = Schema.from('users')
				.pk('id', v.string(), () => 'u')
				.field('name', v.string())
				.build()
			const { adapter } = createInMemoryAdapter()
			const use = adapter.use(schema, { table: 'users' })
			await use.createMany([
				{ id: 'u1', name: 'Alice' },
				{ id: 'u2', name: 'Bob' },
				{ id: 'u3', name: 'Carol' },
			])
			const rows = await use.findMany(FilterGroup.create().notIn('name', ['Alice', 'Carol']))
			expect(rows).toHaveLength(1)
			expect(rows[0].name).toBe('Bob')
		})

		test('exists / notExists filter ops work correctly', async () => {
			const schema = Schema.from('items')
				.pk('id', v.string(), () => 'i')
				.field('val', v.optional(v.string()), { onCreate: () => undefined })
				.build()
			const { adapter } = createInMemoryAdapter()
			const use = adapter.use(schema, { table: 'items' })
			await use.createMany([
				{ id: 'i1', val: 'present' },
				{ id: 'i2', val: null },
				{ id: 'i3', val: undefined },
			])
			const existsRows = await use.findMany(FilterGroup.create().exists('val'))
			expect(existsRows).toHaveLength(1)
			expect(existsRows[0].id).toBe('i1')

			const notExistsRows = await use.findMany(FilterGroup.create().notExists('val'))
			expect(notExistsRows).toHaveLength(2)
		})

		test('crud.findByPk returns seeded document and null for missing', async () => {
			const schema = Schema.from('test')
				.pk('id', v.string(), () => 'gen')
				.build()
			const { adapter } = createInMemoryAdapter()

			const use = adapter.use(schema, { table: 'test' })
			await use.createOne({ id: 'x' })

			const found = await adapter.crud.findByPk!(schema, { table: 'test' }, 'x')
			expect(found).toEqual({ id: 'x' })

			const missing = await adapter.crud.findByPk!(schema, { table: 'test' }, 'missing')
			expect(missing).toBeNull()
		})
	})
}
