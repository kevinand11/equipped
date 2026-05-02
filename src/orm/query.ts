import { toFieldName, type AnyField, type Field } from './fields'

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
	ncontains = 'ncontains',
}

export enum WhereGroupOp {
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
export type WhereFactory = (query: QueryGroup) => QueryGroup

export type QueryOptions<Sel extends string = string> = {
	orderBy?: OrderBy[]
	limit?: number
	offset?: number
	select?: readonly Sel[]
}

export class QueryGroup {
	children: FilterOp[] = []

	private constructor(readonly op: WhereGroupOp = WhereGroupOp.and) {}

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

	in<T>(field: string | Field<T>, value: T[]): this {
		return this.#where(field, WhereOp.in, value)
	}

	nin<T>(field: string | Field<T>, value: T[]): this {
		return this.#where(field, WhereOp.nin, value)
	}

	like(field: string | Field<string>, value: string): this {
		return this.#where(field, WhereOp.like, value)
	}

	exists(field: string | Field<unknown>): this {
		return this.#where(field, WhereOp.exists, true)
	}

	nexists(field: string | Field<unknown>): this {
		return this.#where(field, WhereOp.exists, false)
	}

	contains<T>(field: string | Field<T>, value: T[]): this {
		return this.#where(field, WhereOp.contains, value)
	}

	ncontains<T>(field: string | Field<T>, value: T[]): this {
		return this.#where(field, WhereOp.ncontains, value)
	}

	and(facFns: WhereFactory[]): this {
		const group = new QueryGroup(WhereGroupOp.and)
		group.children = facFns.map((facFn) => facFn(new QueryGroup()))
		this.children.push(group)
		return this
	}

	or(facFns: WhereFactory[]): this {
		const group = new QueryGroup(WhereGroupOp.or)
		group.children = facFns.map((facFn) => facFn(new QueryGroup()))
		this.children.push(group)
		return this
	}

	clone(): QueryGroup {
		const out = new QueryGroup(this.op)
		out.children = this.children.map((c) => {
			if (c instanceof Where) return new Where(c.field, c.op, structuredClone(c.value))
			return c.clone()
		})
		return out
	}

	static from() {
		return new QueryGroup()
	}
}

if (import.meta.vitest) {
	const { describe, test, expect } = import.meta.vitest
	const { v } = await import('valleyed')
	const { defineSchema } = await import('./schema')

	describe('query', () => {
		test('stores clauses and nested groups', () => {
			const group = QueryGroup.from()
				.eq('a', 1)
				.or([(nested) => nested.eq('b', 2), (nested) => nested.eq('c', 3)])
			const clauses = group.children
			expect(clauses).toHaveLength(2)
			expect(clauses[0]).toBeInstanceOf(Where)
			expect(clauses[1]).toBeInstanceOf(QueryGroup)
			expect((clauses[1] as QueryGroup).op).toBe(WhereGroupOp.or)
		})

		test('accepts typed field refs from schema', () => {
			const UserSchema = defineSchema('users', (s) =>
				s.pk('id', v.string(), () => 'u1')
				 .field('age', v.number())
				 .field('email', v.string()),
			)
			const clauses = QueryGroup.from().eq(UserSchema.fields.age, 18).like(UserSchema.fields.email, 'alice').children
			expect((clauses[0] as Where).field).toBe('age')
			expect((clauses[1] as Where).field).toBe('email')
		})
	})
}
