import type { AnyField, Field } from './fields'
import { toFieldName } from './fields'

export enum WhereOp {
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

export enum WhereBlockOp {
	and = 'and',
	or = 'or',
}

export class Where {
	readonly field: string
	constructor(
		field: string | AnyField,
		readonly op: WhereOp,
		readonly value: unknown,
	) {
		this.field = toFieldName(field)
	}
}
export class OrderBy {
	readonly field: string
	constructor(
		field: string | AnyField,
		readonly direction: 'asc' | 'desc',
	) {
		this.field = toFieldName(field)
	}
}

export type FilterOp = Where | QueryGroup

export type QuerySpec = {
	clauses: FilterOp[]
}

export type QueryOptions<Sel extends string = string> = {
	orderBy?: OrderBy[]
	limit?: number
	offset?: number
	select?: readonly Sel[]
}

export class QueryGroup {
	children: (Where | QueryGroup)[] = []

	private constructor(readonly op: WhereBlockOp | null = null) {}

	#where(field: string | AnyField, condition: WhereOp, value: unknown): this {
		this.children.push(new Where(field, condition, value))
		return this
	}

	eq<T>(field: string | Field<T>, value: T): this {
		return this.#where(field, WhereOp.eq, value)
	}

	ne<T>(field: string | Field<T>, value: T): this {
		return this.#where(field, WhereOp.ne, value)
	}

	gt<T>(field: string | Field<T>, value: T): this {
		return this.#where(field, WhereOp.gt, value)
	}

	gte<T>(field: string | Field<T>, value: T): this {
		return this.#where(field, WhereOp.gte, value)
	}

	lt<T>(field: string | Field<T>, value: T): this {
		return this.#where(field, WhereOp.lt, value)
	}

	lte<T>(field: string | Field<T>, value: T): this {
		return this.#where(field, WhereOp.lte, value)
	}

	isIn<T>(field: string | Field<T>, value: T[]): this {
		return this.#where(field, WhereOp.in, value)
	}

	notIn<T>(field: string | Field<T>, value: T[]): this {
		return this.#where(field, WhereOp.nin, value)
	}

	like(field: string | Field<string>, value: string): this {
		return this.#where(field, WhereOp.like, value)
	}

	exists(field: string | Field<unknown>): this {
		return this.#where(field, WhereOp.exists, true)
	}

	notExists(field: string | Field<unknown>): this {
		return this.#where(field, WhereOp.exists, false)
	}

	contains<T>(field: string | Field<T>, value: T[]): this {
		return this.#where(field, WhereOp.contains, value)
	}

	notContains<T>(field: string | Field<T>, value: T[]): this {
		return this.#where(field, WhereOp.notContains, value)
	}

	and(facFn: (query: QueryGroup) => QueryGroup): this {
		const group = new QueryGroup(WhereBlockOp.and)
		this.children.push(facFn(group))
		return this
	}

	or(facFn: (query: QueryGroup) => QueryGroup): this {
		const group = new QueryGroup(WhereBlockOp.or)
		this.children.push(facFn(group))
		return this
	}

	static from() {
		return new QueryGroup()
	}
}

export class Query<Sel extends readonly string[] = string[]> {
	readonly #group = QueryGroup.from()
	readonly #orderByOps: OrderBy[] = []
	#limit: number | undefined
	#offset: number | undefined
	#select: Sel | undefined

	private constructor() {}

	static from(): Query {
		return new Query()
	}

	eq<T>(field: string | Field<T>, value: T): this {
		this.#group.eq(field, value)
		return this
	}

	ne<T>(field: string | Field<T>, value: T): this {
		this.#group.ne(field, value)
		return this
	}

	gt<T>(field: string | Field<T>, value: T): this {
		this.#group.gt(field, value)
		return this
	}

	gte<T>(field: string | Field<T>, value: T): this {
		this.#group.gte(field, value)
		return this
	}

	lt<T>(field: string | Field<T>, value: T): this {
		this.#group.lt(field, value)
		return this
	}

	lte<T>(field: string | Field<T>, value: T): this {
		this.#group.lte(field, value)
		return this
	}

	isIn<T>(field: string | Field<T>, value: T[]): this {
		this.#group.isIn(field, value)
		return this
	}

	notIn<T>(field: string | Field<T>, value: T[]): this {
		this.#group.notIn(field, value)
		return this
	}

	like(field: string | Field<string>, value: string): this {
		this.#group.like(field, value)
		return this
	}

	exists(field: string | Field<unknown>): this {
		this.#group.exists(field)
		return this
	}

	notExists(field: string | Field<unknown>): this {
		this.#group.notExists(field)
		return this
	}

	contains<T>(field: string | Field<T>, value: T[]): this {
		this.#group.contains(field, value)
		return this
	}

	notContains<T>(field: string | Field<T>, value: T[]): this {
		this.#group.notContains(field, value)
		return this
	}

	and(group: (query: QueryGroup) => QueryGroup): this {
		this.#group.and(group)
		return this
	}

	or(group: (query: QueryGroup) => QueryGroup): this {
		this.#group.or(group)
		return this
	}

	orderBy(field: string | Field<unknown>, direction: 'asc' | 'desc' = 'asc'): this {
		this.#orderByOps.push(new OrderBy(field, direction))
		return this
	}

	limit(limit: number): this {
		this.#limit = limit
		return this
	}

	offset(offset: number): this {
		this.#offset = offset
		return this
	}

	select(select: Sel): this {
		this.#select = select
		return this
	}

	toQuerySpec(): QuerySpec {
		return {
			clauses: this.#group.children,
		}
	}

	toOptions(): QueryOptions {
		return {
			orderBy: this.#orderByOps,
			offset: this.#offset,
			limit: this.#limit,
			select: this.#select,
		}
	}
}

if (import.meta.vitest) {
	const { describe, test, expect } = import.meta.vitest
	const { v } = await import('valleyed')
	const { Schema } = await import('./schema')

	describe('query', () => {
		describe('QueryGroup', () => {
			test('stores clauses and nested groups', () => {
				const group = QueryGroup.from()
					.eq('a', 1)
					.or((nested) => nested.eq('b', 2).eq('c', 3))
				const clauses = group.children
				expect(clauses).toHaveLength(2)
				expect(clauses[0]).toBeInstanceOf(Where)
				expect(clauses[1]).toBeInstanceOf(QueryGroup)
				expect((clauses[1] as QueryGroup).op).toBe(WhereBlockOp.or)
			})

			test('accepts typed field refs from schema', () => {
				const UserSchema = Schema.from('users')
					.pk('id', v.string(), () => 'u1')
					.field('age', v.number())
					.field('email', v.string())
				const clauses = QueryGroup.from().eq(UserSchema.fields.age, 18).like(UserSchema.fields.email, 'alice').children
				expect((clauses[0] as Where).field).toBe('age')
				expect((clauses[1] as Where).field).toBe('email')
			})
		})

		describe('Query chainable API', () => {
			test('query spec', () => {
				const built = Query.from()
					.eq('age', 18)
					.and((q) => q.eq('status', 'active').or((nested) => nested.like('name', 'ali').eq('role', 'admin')))
					.orderBy('createdAt', 'desc')
					.limit(10)
					.offset(5)
					.select(['id', 'name'])


				const spec = built.toQuerySpec()
				const options = built.toOptions()

				expect(spec.clauses).toHaveLength(2)
				expect(spec.clauses[0]).toBeInstanceOf(Where)
				expect(spec.clauses[1]).toBeInstanceOf(QueryGroup)
				expect((spec.clauses[1] as QueryGroup).op).toBe(WhereBlockOp.and)
				expect(options.orderBy).toHaveLength(1)
				expect(options.limit).toBe(10)
				expect(options.offset).toBe(5)
				expect(options.select).toEqual(['id', 'name'])
			})

			test('defaults orderBy direction to asc', () => {
				const options = Query.from().orderBy('name').toOptions()
				expect(options.orderBy?.[0].direction).toBe('asc')
			})
		})
	})
}
