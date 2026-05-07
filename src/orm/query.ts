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
	readonly children: readonly FilterOp[]

	private constructor(
		readonly op: WhereGroupOp = WhereGroupOp.and,
		children?: readonly FilterOp[],
	) {
		this.children = children ?? []
	}

	#withChild(child: FilterOp): QueryGroup {
		return new QueryGroup(this.op, [...this.children, child])
	}

	eq<T>(field: string | Field<T>, value: T): QueryGroup {
		return this.#withChild(new Where(field, WhereOp.eq, value))
	}

	ne<T>(field: string | Field<T>, value: T): QueryGroup {
		return this.#withChild(new Where(field, WhereOp.ne, value))
	}

	gt<T>(field: string | Field<T>, value: T): QueryGroup {
		return this.#withChild(new Where(field, WhereOp.gt, value))
	}

	gte<T>(field: string | Field<T>, value: T): QueryGroup {
		return this.#withChild(new Where(field, WhereOp.gte, value))
	}

	lt<T>(field: string | Field<T>, value: T): QueryGroup {
		return this.#withChild(new Where(field, WhereOp.lt, value))
	}

	lte<T>(field: string | Field<T>, value: T): QueryGroup {
		return this.#withChild(new Where(field, WhereOp.lte, value))
	}

	in<T>(field: string | Field<T>, value: T[]): QueryGroup {
		return this.#withChild(new Where(field, WhereOp.in, value))
	}

	nin<T>(field: string | Field<T>, value: T[]): QueryGroup {
		return this.#withChild(new Where(field, WhereOp.nin, value))
	}

	like(field: string | Field<string>, value: string): QueryGroup {
		return this.#withChild(new Where(field, WhereOp.like, value))
	}

	exists(field: string | Field<unknown>): QueryGroup {
		return this.#withChild(new Where(field, WhereOp.exists, true))
	}

	nexists(field: string | Field<unknown>): QueryGroup {
		return this.#withChild(new Where(field, WhereOp.exists, false))
	}

	contains<T>(field: string | Field<T>, value: T[]): QueryGroup {
		return this.#withChild(new Where(field, WhereOp.contains, value))
	}

	ncontains<T>(field: string | Field<T>, value: T[]): QueryGroup {
		return this.#withChild(new Where(field, WhereOp.ncontains, value))
	}

	and(facFns: WhereFactory[]): QueryGroup {
		const group = new QueryGroup(WhereGroupOp.and, facFns.map((facFn) => facFn(QueryGroup.from())))
		return this.#withChild(group)
	}

	or(facFns: WhereFactory[]): QueryGroup {
		const group = new QueryGroup(WhereGroupOp.or, facFns.map((facFn) => facFn(QueryGroup.from())))
		return this.#withChild(group)
	}

	clone(): QueryGroup {
		return new QueryGroup(
			this.op,
			this.children.map((c) => {
				if (c instanceof Where) return new Where(c.field, c.op, structuredClone(c.value))
				return c.clone()
			}),
		)
	}

	static from() {
		return new QueryGroup()
	}
}

if (import.meta.vitest) {
	const { describe, test, expect } = import.meta.vitest
	const { v } = await import('valleyed')
	const { Schema } = await import('./schema')

	describe('clone-on-step: fan-out independence', () => {
		test('.eq() returns a new QueryGroup, not the same instance', () => {
			const base = QueryGroup.from()
			const a = base.eq('name', 'Alice')
			expect(a).not.toBe(base)
		})

		test('fan-out from shared base does not pollute either branch', () => {
			const base = QueryGroup.from().eq('name', 'Alice')
			const branchA = base.gt('age', 20)
			const branchB = base.lt('age', 40)

			expect(branchA.children).toHaveLength(2)
			expect(branchB.children).toHaveLength(2)
			expect(base.children).toHaveLength(1)
			expect((branchA.children[1] as Where).op).toBe(WhereOp.gt)
			expect((branchB.children[1] as Where).op).toBe(WhereOp.lt)
		})

		test('.and() returns a new QueryGroup', () => {
			const base = QueryGroup.from().eq('name', 'Alice')
			const withAnd = base.and([(q) => q.gt('age', 20)])
			expect(withAnd).not.toBe(base)
			expect(base.children).toHaveLength(1)
			expect(withAnd.children).toHaveLength(2)
		})

		test('.or() returns a new QueryGroup', () => {
			const base = QueryGroup.from().eq('name', 'Alice')
			const withOr = base.or([(q) => q.gt('age', 20)])
			expect(withOr).not.toBe(base)
			expect(base.children).toHaveLength(1)
			expect(withOr.children).toHaveLength(2)
		})
	})

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
			const UserSchema = Schema.from('users')
				.pk('id', v.string(), () => 'u1')
				.field('age', v.number())
				.field('email', v.string())
				.build()
			const clauses = QueryGroup.from().eq(UserSchema.fields.age, 18).like(UserSchema.fields.email, 'alice').children
			expect((clauses[0] as Where).field).toBe('age')
			expect((clauses[1] as Where).field).toBe('email')
		})
	})
}
