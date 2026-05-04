import { Filter, FilterGroup, type FilterChild } from '../../filter'
import type { QueryOptions } from '../../query'
import { IncOp, MaxOp, MinOp, MulOp, PatchOp, PullOp, PushOp, SetOp, UnsetOp, type AnyUpdateOp } from '../../updates'

type MongoFilter = Record<string, unknown>

export function compileMongoFilter(group: FilterGroup, primaryKey: string): MongoFilter {
	const clauses: MongoFilter[] = []
	for (const child of group.children) {
		const compiled = compileChild(child, primaryKey)
		if (compiled) clauses.push(compiled)
	}

	if (clauses.length === 0) return {}
	if (clauses.length === 1) return clauses[0]
	return { $and: clauses }
}

export function compileMongoQuery(
	group: FilterGroup,
	options: QueryOptions | undefined,
	primaryKey: string,
): {
	filter: MongoFilter
	sort: Record<string, 1 | -1> | undefined
	limit: number | undefined
	skip: number | undefined
	projection: Record<string, 1> | undefined
} {
	const mongoFilter = compileMongoFilter(group, primaryKey)

	const orderBys = options?.orderBy ?? []
	const sort =
		orderBys.length > 0
			? Object.fromEntries(orderBys.map((o) => [mapField(o.field, primaryKey), o.direction === 'desc' ? -1 : 1]))
			: undefined

	const selects = options?.select ?? []
	const projection = selects.length > 0 ? Object.fromEntries(selects.map((f) => [mapField(f, primaryKey), 1])) : undefined

	return {
		filter: mongoFilter,
		sort: sort as Record<string, 1 | -1> | undefined,
		limit: options?.limit ?? undefined,
		skip: options?.offset ?? undefined,
		projection: projection as Record<string, 1> | undefined,
	}
}

function mapField(field: string, primaryKey: string): string {
	if (field === 'id' && primaryKey === '_id') return '_id'
	return field
}

function compileFilter(f: Filter, primaryKey: string): MongoFilter {
	const field = mapField(f.field, primaryKey)

	switch (f.op) {
		case 'eq':
			return { [field]: { $eq: f.value } }
		case 'ne':
			return { [field]: { $ne: f.value } }
		case 'gt':
			return { [field]: { $gt: f.value } }
		case 'gte':
			return { [field]: { $gte: f.value } }
		case 'lt':
			return { [field]: { $lt: f.value } }
		case 'lte':
			return { [field]: { $lte: f.value } }
		case 'in':
			return { [field]: { $in: f.value } }
		case 'notIn':
			return { [field]: { $nin: f.value } }
		case 'like':
			return { [field]: { $regex: new RegExp(String(f.value), 'i') } }
		case 'exists':
			return { [field]: { $exists: true, $ne: null } }
		case 'notExists':
			return { [field]: { $eq: null } }
		case 'contains':
			return { [field]: { $all: Array.isArray(f.value) ? f.value : [f.value] } }
		case 'notContains':
			return { [field]: { $not: { $all: Array.isArray(f.value) ? f.value : [f.value] } } }
		default:
			return { [field]: { $eq: f.value } }
	}
}

function compileChild(child: FilterChild, primaryKey: string): MongoFilter | null {
	if (child instanceof Filter) return compileFilter(child, primaryKey)
	if (child instanceof FilterGroup) {
		if (child.op === 'and') return compileAndGroup(child, primaryKey)
		if (child.op === 'or') return compileOrGroup(child, primaryKey)
	}
	return null
}

function compileAndGroup(group: FilterGroup, primaryKey: string): MongoFilter | null {
	const clauses = group.children.map((c) => compileChild(c, primaryKey)).filter((c): c is MongoFilter => c !== null)
	if (clauses.length === 0) return null
	if (clauses.length === 1) return clauses[0]
	return { $and: clauses }
}

function compileOrGroup(group: FilterGroup, primaryKey: string): MongoFilter | null {
	const clauses = group.children.map((c) => compileChild(c, primaryKey)).filter((c): c is MongoFilter => c !== null)
	if (clauses.length === 0) return null
	if (clauses.length === 1) return clauses[0]
	return { $or: clauses }
}

export function compileMongoUpdate(data: Record<string, unknown>): Record<string, unknown> {
	const $set: Record<string, unknown> = {}
	const $inc: Record<string, unknown> = {}
	const $mul: Record<string, unknown> = {}
	const $min: Record<string, unknown> = {}
	const $max: Record<string, unknown> = {}
	const $unset: Record<string, ''> = {}
	const $push: Record<string, unknown> = {}
	const $pull: Record<string, unknown> = {}

	for (const [key, value] of Object.entries(data)) {
		if (value instanceof IncOp) $inc[key] = value.value
		else if (value instanceof MulOp) $mul[key] = value.value
		else if (value instanceof MinOp) $min[key] = value.value
		else if (value instanceof MaxOp) $max[key] = value.value
		else if (value instanceof UnsetOp) $unset[key] = ''
		else if (value instanceof PushOp) $push[key] = value.value
		else if (value instanceof PullOp) $pull[key] = value.value
		else if (value instanceof PatchOp) {
			const patchVal = value.value as Record<string, unknown>
			for (const [subKey, subVal] of Object.entries(patchVal)) {
				$set[`${key}.${subKey}`] = subVal
			}
		} else $set[key] = value
	}

	const result: Record<string, unknown> = {}
	if (Object.keys($set).length) result.$set = $set
	if (Object.keys($inc).length) result.$inc = $inc
	if (Object.keys($mul).length) result.$mul = $mul
	if (Object.keys($min).length) result.$min = $min
	if (Object.keys($max).length) result.$max = $max
	if (Object.keys($unset).length) result.$unset = $unset
	if (Object.keys($push).length) result.$push = $push
	if (Object.keys($pull).length) result.$pull = $pull

	return result
}

export function compileMongoOps(ops: AnyUpdateOp[]): Record<string, unknown> {
	const $set: Record<string, unknown> = {}
	const $inc: Record<string, unknown> = {}
	const $mul: Record<string, unknown> = {}
	const $min: Record<string, unknown> = {}
	const $max: Record<string, unknown> = {}
	const $unset: Record<string, ''> = {}
	const $push: Record<string, unknown> = {}
	const $pull: Record<string, unknown> = {}

	for (const op of ops) {
		if (op instanceof SetOp) {
			Object.assign($set, op.values)
		} else if (op instanceof IncOp) {
			$inc[op.field] = op.value
		} else if (op instanceof MulOp) {
			$mul[op.field] = op.value
		} else if (op instanceof MinOp) {
			$min[op.field] = op.value
		} else if (op instanceof MaxOp) {
			$max[op.field] = op.value
		} else if (op instanceof UnsetOp) {
			$unset[op.field] = ''
		} else if (op instanceof PushOp) {
			$push[op.field] = op.value
		} else if (op instanceof PullOp) {
			$pull[op.field] = op.value
		} else if (op instanceof PatchOp) {
			const patchVal = op.value as Record<string, unknown>
			for (const [subKey, subVal] of Object.entries(patchVal)) {
				$set[`${op.field}.${subKey}`] = subVal
			}
		}
	}

	const result: Record<string, unknown> = {}
	if (Object.keys($set).length) result.$set = $set
	if (Object.keys($inc).length) result.$inc = $inc
	if (Object.keys($mul).length) result.$mul = $mul
	if (Object.keys($min).length) result.$min = $min
	if (Object.keys($max).length) result.$max = $max
	if (Object.keys($unset).length) result.$unset = $unset
	if (Object.keys($push).length) result.$push = $push
	if (Object.keys($pull).length) result.$pull = $pull

	return result
}

if (import.meta.vitest) {
	const { describe, test, expect } = import.meta.vitest
	const { FilterGroup } = await import('../../filter')
	const { OrderBy } = await import('../../query')

	describe('compileMongoFilter', () => {
		test('empty filter group compiles to empty object', () => {
			const group = FilterGroup.create()
			expect(compileMongoFilter(group, 'id')).toEqual({})
		})

		test('single eq filter compiles to $eq', () => {
			const group = FilterGroup.create().eq('name', 'Alice')
			expect(compileMongoFilter(group, 'id')).toEqual({ name: { $eq: 'Alice' } })
		})

		test('ne, gt, gte, lt, lte compile to corresponding Mongo ops', () => {
			expect(compileMongoFilter(FilterGroup.create().ne('age', 5), 'id')).toEqual({ age: { $ne: 5 } })
			expect(compileMongoFilter(FilterGroup.create().gt('age', 10), 'id')).toEqual({ age: { $gt: 10 } })
			expect(compileMongoFilter(FilterGroup.create().gte('age', 20), 'id')).toEqual({ age: { $gte: 20 } })
			expect(compileMongoFilter(FilterGroup.create().lt('age', 30), 'id')).toEqual({ age: { $lt: 30 } })
			expect(compileMongoFilter(FilterGroup.create().lte('age', 40), 'id')).toEqual({ age: { $lte: 40 } })
		})

		test('in compiles to $in', () => {
			const group = FilterGroup.create().in('status', ['a', 'b'])
			expect(compileMongoFilter(group, 'id')).toEqual({ status: { $in: ['a', 'b'] } })
		})

		test('notIn compiles to $nin (canonical name notIn, Mongo op $nin)', () => {
			const group = FilterGroup.create().notIn('status', ['x', 'y'])
			expect(compileMongoFilter(group, 'id')).toEqual({ status: { $nin: ['x', 'y'] } })
		})

		test('like compiles to $regex with case-insensitive flag', () => {
			const group = FilterGroup.create().like('name', 'ali')
			const result = compileMongoFilter(group, 'id')
			expect(result.name).toEqual({ $regex: expect.any(RegExp) })
			const regex = (result.name as any).$regex as RegExp
			expect(regex.flags).toBe('i')
			expect(regex.test('Alice')).toBe(true)
		})

		test('exists compiles to $exists: true, $ne: null', () => {
			const group = FilterGroup.create().exists('val')
			expect(compileMongoFilter(group, 'id')).toEqual({ val: { $exists: true, $ne: null } })
		})

		test('notExists is its own op — compiles to $eq: null', () => {
			const group = FilterGroup.create().notExists('val')
			expect(compileMongoFilter(group, 'id')).toEqual({ val: { $eq: null } })
		})

		test('contains compiles to $all', () => {
			const group = FilterGroup.create().contains('tags', ['a', 'b'])
			expect(compileMongoFilter(group, 'id')).toEqual({ tags: { $all: ['a', 'b'] } })
		})

		test('notContains compiles to $not: { $all }', () => {
			const group = FilterGroup.create().notContains('tags', ['x'])
			expect(compileMongoFilter(group, 'id')).toEqual({ tags: { $not: { $all: ['x'] } } })
		})

		test('multiple clauses produce $and', () => {
			const group = FilterGroup.create().eq('a', 1).gt('b', 2)
			const result = compileMongoFilter(group, 'id')
			expect(result).toEqual({ $and: [{ a: { $eq: 1 } }, { b: { $gt: 2 } }] })
		})

		test('nested and/or groups compile correctly', () => {
			const group = FilterGroup.create().and([
				(q) => q.eq('a', 1),
				(q) => q.or([(g) => g.eq('b', 2), (g) => g.eq('c', 3)]),
			])
			const result = compileMongoFilter(group, 'id')
			expect(result).toEqual({
				$and: [{ a: { $eq: 1 } }, { $or: [{ b: { $eq: 2 } }, { c: { $eq: 3 } }] }],
			})
		})

		test('maps id field to _id when primaryKey is _id', () => {
			const group = FilterGroup.create().eq('id', 'abc')
			expect(compileMongoFilter(group, '_id')).toEqual({ _id: { $eq: 'abc' } })
		})
	})

	describe('compileMongoQuery', () => {
		test('options: sort, limit, skip, projection', () => {
			const group = FilterGroup.create().eq('active', true)
			const options = {
				orderBy: [new OrderBy('name', 'asc'), new OrderBy('age', 'desc')],
				limit: 10,
				offset: 5,
				select: ['name', 'age'] as const,
			}
			const result = compileMongoQuery(group, options, 'id')
			expect(result.filter).toEqual({ active: { $eq: true } })
			expect(result.sort).toEqual({ name: 1, age: -1 })
			expect(result.limit).toBe(10)
			expect(result.skip).toBe(5)
			expect(result.projection).toEqual({ name: 1, age: 1 })
		})

		test('undefined options returns undefined for sort/limit/skip/projection', () => {
			const group = FilterGroup.create().eq('x', 1)
			const result = compileMongoQuery(group, undefined, 'id')
			expect(result.sort).toBeUndefined()
			expect(result.limit).toBeUndefined()
			expect(result.skip).toBeUndefined()
			expect(result.projection).toBeUndefined()
		})
	})

	describe('compileMongoUpdate', () => {
		test('plain values go into $set', () => {
			const result = compileMongoUpdate({ name: 'Alice', age: 30 })
			expect(result).toEqual({ $set: { name: 'Alice', age: 30 } })
		})

		test('IncOp goes into $inc', () => {
			const result = compileMongoUpdate({ count: new IncOp('count', 5) })
			expect(result).toEqual({ $inc: { count: 5 } })
		})

		test('MulOp goes into $mul', () => {
			const result = compileMongoUpdate({ score: new MulOp('score', 2) })
			expect(result).toEqual({ $mul: { score: 2 } })
		})

		test('MinOp/MaxOp go into $min/$max', () => {
			const result = compileMongoUpdate({
				lo: new MinOp('lo', 1),
				hi: new MaxOp('hi', 99),
			})
			expect(result).toEqual({ $min: { lo: 1 }, $max: { hi: 99 } })
		})

		test('UnsetOp goes into $unset', () => {
			const result = compileMongoUpdate({ old: new UnsetOp('old') })
			expect(result).toEqual({ $unset: { old: '' } })
		})

		test('PushOp/PullOp go into $push/$pull', () => {
			const result = compileMongoUpdate({
				tags: new PushOp('tags', 'new'),
				removed: new PullOp('removed', 'old'),
			})
			expect(result).toEqual({ $push: { tags: 'new' }, $pull: { removed: 'old' } })
		})

		test('PatchOp produces dot-notation $set entries', () => {
			const result = compileMongoUpdate({ meta: new PatchOp('meta', { a: 1, b: 2 }) })
			expect(result).toEqual({ $set: { 'meta.a': 1, 'meta.b': 2 } })
		})

		test('empty data produces empty result', () => {
			const result = compileMongoUpdate({})
			expect(result).toEqual({})
		})
	})

	describe('compileMongoOps', () => {
		test('SetOp values go into $set', () => {
			const result = compileMongoOps([new SetOp({ name: 'Bob', age: 25 })])
			expect(result).toEqual({ $set: { name: 'Bob', age: 25 } })
		})

		test('mixed ops compile to separate Mongo update operators', () => {
			const result = compileMongoOps([
				new SetOp({ name: 'Alice' }),
				new IncOp('count', 1),
				new PushOp('tags', 'x'),
			])
			expect(result).toEqual({
				$set: { name: 'Alice' },
				$inc: { count: 1 },
				$push: { tags: 'x' },
			})
		})

		test('empty ops produces empty result', () => {
			expect(compileMongoOps([])).toEqual({})
		})
	})
}
