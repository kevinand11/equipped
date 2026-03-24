export enum Condition {
	eq = 'eq',
	ne = 'ne',
	gt = 'gt',
	gte = 'gte',
	lt = 'lt',
	lte = 'lte',
	in = 'in',
	nin = 'nin',
	like = 'like',
	exists = 'exists',
	contains = 'contains',
	notContains = 'notContains',
}

export class WhereOp {
	constructor(
		readonly field: string,
		readonly condition: Condition,
		readonly value: unknown,
	) {}
}
export class AndOp {
	constructor(readonly clauses: FilterOp[]) {}
}
export class OrOp {
	constructor(readonly clauses: FilterOp[]) {}
}
export class RawOp {
	constructor(readonly value: unknown) {}
}
export class OrderByOp {
	constructor(
		readonly field: string,
		readonly direction: 'asc' | 'desc',
	) {}
}

export type FilterOp = WhereOp | AndOp | OrOp | RawOp

export type QueryFilter = {
	wheres: WhereOp[]
	ands: AndOp[]
	ors: OrOp[]
	raws: unknown[]
}

export type QueryOptions<Sel extends string = string> = {
	orderBy?: OrderByOp[]
	limit?: number
	offset?: number
	select?: Sel[]
}

export function query(...ops: FilterOp[]): QueryFilter {
	const filter: QueryFilter = { wheres: [], ands: [], ors: [], raws: [] }
	for (const op of ops) {
		if (op instanceof WhereOp) filter.wheres.push(op)
		else if (op instanceof AndOp) filter.ands.push(op)
		else if (op instanceof OrOp) filter.ors.push(op)
		else if (op instanceof RawOp) filter.raws.push(op.value)
	}
	return filter
}

export const eq = <T>(field: string, value: T) => new WhereOp(field, Condition.eq, value)
export const ne = <T>(field: string, value: T) => new WhereOp(field, Condition.ne, value)
export const gt = <T>(field: string, value: T) => new WhereOp(field, Condition.gt, value)
export const gte = <T>(field: string, value: T) => new WhereOp(field, Condition.gte, value)
export const lt = <T>(field: string, value: T) => new WhereOp(field, Condition.lt, value)
export const lte = <T>(field: string, value: T) => new WhereOp(field, Condition.lte, value)
export const isIn = <T>(field: string, value: T[]) => new WhereOp(field, Condition.in, value)
export const notIn = <T>(field: string, value: T[]) => new WhereOp(field, Condition.nin, value)
export const like = (field: string, value: string) => new WhereOp(field, Condition.like, value)
export const exists = (field: string) => new WhereOp(field, Condition.exists, true)
export const notExists = (field: string) => new WhereOp(field, Condition.exists, false)
export const contains = <T>(field: string, value: T[]) => new WhereOp(field, Condition.contains, value)
export const notContains = <T>(field: string, value: T[]) => new WhereOp(field, Condition.notContains, value)
export const and = (...clauses: FilterOp[]) => new AndOp(clauses)
export const or = (...clauses: FilterOp[]) => new OrOp(clauses)
export const raw = (value: unknown) => new RawOp(value)
export const orderBy = (field: string, direction: 'asc' | 'desc' = 'asc') => new OrderByOp(field, direction)

if (import.meta.vitest) {
	const { describe, test, expect } = import.meta.vitest

	describe('query', () => {
		describe('query() builder', () => {
			test('empty filter has all empty collections', () => {
				const f = query()
				expect(f.wheres).toEqual([])
				expect(f.ands).toEqual([])
				expect(f.ors).toEqual([])
				expect(f.raws).toEqual([])
			})
			test('routes WhereOp to wheres', () => {
				const f = query(eq('x', 1))
				expect(f.wheres).toHaveLength(1)
				expect(f.wheres[0]).toBeInstanceOf(WhereOp)
			})
			test('routes AndOp to ands', () => {
				expect(query(and(eq('a', 1), eq('b', 2))).ands).toHaveLength(1)
			})
			test('routes OrOp to ors', () => {
				expect(query(or(eq('a', 1), eq('b', 2))).ors).toHaveLength(1)
			})
			test('routes RawOp value to raws', () => {
				expect(query(raw({ custom: true })).raws).toEqual([{ custom: true }])
			})
			test('accepts mixed op types in one call', () => {
				const f = query(eq('a', 1), and(eq('b', 2), eq('c', 3)), or(eq('d', 4), eq('e', 5)), raw(null))
				expect(f.wheres).toHaveLength(1)
				expect(f.ands).toHaveLength(1)
				expect(f.ors).toHaveLength(1)
				expect(f.raws).toHaveLength(1)
			})
		})

		describe('condition factories', () => {
			test('eq stores field, condition, value', () => {
				const op = eq('age', 18)
				expect(op).toBeInstanceOf(WhereOp)
				expect(op.field).toBe('age')
				expect(op.condition).toBe(Condition.eq)
				expect(op.value).toBe(18)
			})
			test('ne', () => {
				expect(ne('x', 1).condition).toBe(Condition.ne)
			})
			test('gt', () => {
				expect(gt('x', 1).condition).toBe(Condition.gt)
			})
			test('gte', () => {
				expect(gte('x', 1).condition).toBe(Condition.gte)
			})
			test('lt', () => {
				expect(lt('x', 1).condition).toBe(Condition.lt)
			})
			test('lte', () => {
				expect(lte('x', 1).condition).toBe(Condition.lte)
			})
			test('isIn stores array value', () => {
				const op = isIn('status', ['a', 'b'])
				expect(op.condition).toBe(Condition.in)
				expect(op.value).toEqual(['a', 'b'])
			})
			test('notIn', () => {
				expect(notIn('x', ['y']).condition).toBe(Condition.nin)
			})
			test('like', () => {
				expect(like('name', 'alice').condition).toBe(Condition.like)
			})
			test('exists sets value true', () => {
				expect(exists('email').condition).toBe(Condition.exists)
				expect(exists('email').value).toBe(true)
			})
			test('notExists sets value false', () => {
				expect(notExists('email').value).toBe(false)
			})
			test('contains', () => {
				expect(contains('tags', ['a']).condition).toBe(Condition.contains)
			})
			test('notContains', () => {
				expect(notContains('tags', ['a']).condition).toBe(Condition.notContains)
			})
		})

		describe('and() / or()', () => {
			test('and stores all clauses', () => {
				const op = and(eq('a', 1), eq('b', 2), eq('c', 3))
				expect(op).toBeInstanceOf(AndOp)
				expect(op.clauses).toHaveLength(3)
			})
			test('or stores all clauses', () => {
				const op = or(eq('a', 1), eq('b', 2))
				expect(op).toBeInstanceOf(OrOp)
				expect(op.clauses).toHaveLength(2)
			})
			test('clauses can be nested', () => {
				const op = or(and(eq('a', 1), eq('b', 2)), eq('c', 3))
				expect(op.clauses[0]).toBeInstanceOf(AndOp)
				expect(op.clauses[1]).toBeInstanceOf(WhereOp)
			})
		})

		describe('orderBy()', () => {
			test('defaults direction to asc', () => {
				expect(orderBy('name').direction).toBe('asc')
			})
			test('accepts desc', () => {
				expect(orderBy('name', 'desc').direction).toBe('desc')
			})
			test('stores field name', () => {
				expect(orderBy('createdAt').field).toBe('createdAt')
			})
			test('returns OrderByOp', () => {
				expect(orderBy('x')).toBeInstanceOf(OrderByOp)
			})
		})

		describe('raw()', () => {
			test('stores value as RawOp', () => {
				const r = raw({ $expr: 1 })
				expect(r).toBeInstanceOf(RawOp)
				expect(r.value).toEqual({ $expr: 1 })
			})
		})
	})
}
