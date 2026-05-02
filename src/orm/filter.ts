import type { FilterOpName } from './adapter'
import { toFieldName, type AnyField, type Field } from './fields'
import type { AnySchema } from './schema'
import { EquippedError } from '../errors'

export class Filter {
	readonly field: string
	constructor(
		field: string | AnyField,
		readonly op: FilterOpName,
		readonly value: unknown,
	) {
		this.field = toFieldName(field)
	}
}

export type FilterChild = Filter | FilterGroup

export type FilterFactory = (q: FilterGroup) => FilterGroup

export type FilterGroupOp = 'and' | 'or'

export class FilterGroup {
	readonly children: FilterChild[] = []

	private constructor(readonly op: FilterGroupOp = 'and') {}

	#addFilter(field: string | AnyField, condition: FilterOpName, value: unknown): this {
		this.children.push(new Filter(field, condition, value))
		return this
	}

	eq<T>(field: string | Field<T>, value: T): this {
		return this.#addFilter(field, 'eq', value)
	}

	ne<T>(field: string | Field<T>, value: T): this {
		return this.#addFilter(field, 'ne', value)
	}

	gt<T>(field: string | Field<T>, value: T): this {
		return this.#addFilter(field, 'gt', value)
	}

	gte<T>(field: string | Field<T>, value: T): this {
		return this.#addFilter(field, 'gte', value)
	}

	lt<T>(field: string | Field<T>, value: T): this {
		return this.#addFilter(field, 'lt', value)
	}

	lte<T>(field: string | Field<T>, value: T): this {
		return this.#addFilter(field, 'lte', value)
	}

	in<T>(field: string | Field<T>, value: T[]): this {
		return this.#addFilter(field, 'in', value)
	}

	notIn<T>(field: string | Field<T>, value: T[]): this {
		return this.#addFilter(field, 'notIn', value)
	}

	like(field: string | Field<string>, value: string): this {
		return this.#addFilter(field, 'like', value)
	}

	exists(field: string | Field<unknown>): this {
		return this.#addFilter(field, 'exists', true)
	}

	notExists(field: string | Field<unknown>): this {
		return this.#addFilter(field, 'notExists', true)
	}

	contains<T>(field: string | Field<T>, value: T[]): this {
		return this.#addFilter(field, 'contains', value)
	}

	notContains<T>(field: string | Field<T>, value: T[]): this {
		return this.#addFilter(field, 'notContains', value)
	}

	and(facFns: FilterFactory[]): this {
		if (facFns.length === 0) throw new EquippedError('and() requires at least one filter factory', { op: 'and' })
		const group = new FilterGroup('and')
		group.children.push(...facFns.map((fn) => fn(new FilterGroup())))
		this.children.push(group)
		return this
	}

	or(facFns: FilterFactory[]): this {
		if (facFns.length === 0) throw new EquippedError('or() requires at least one filter factory', { op: 'or' })
		const group = new FilterGroup('or')
		group.children.push(...facFns.map((fn) => fn(new FilterGroup())))
		this.children.push(group)
		return this
	}

	clone(): FilterGroup {
		const out = new FilterGroup(this.op)
		out.children.push(
			...this.children.map((c) => {
				if (c instanceof Filter) return new Filter(c.field, c.op, structuredClone(c.value))
				return c.clone()
			}),
		)
		return out
	}

	static create(): FilterGroup {
		return new FilterGroup()
	}
}

export class OrmValidationError extends EquippedError {
	constructor(
		message: string,
		readonly kind: 'validation' | 'conflicting-ops' | 'empty-group' | 'undeclared-op' | 'upsert-filter-incompatible',
		readonly schema: string,
		readonly operation: string,
		readonly failures: Array<{
			opIndex?: number
			rowIndex?: number
			field?: string
			cause?: unknown
		}> = [],
	) {
		super(message, { kind, schema, operation, failures })
	}
}

export type GatedFilterGroup<DeclaredOps extends readonly FilterOpName[]> = {
	[K in FilterOpName]: K extends DeclaredOps[number] ? FilterGroup[K] : never
} & Pick<FilterGroup, 'and' | 'or' | 'clone' | 'children' | 'op'>

export type GatedFilterFactory<DeclaredOps extends readonly FilterOpName[]> = (
	q: GatedFilterGroup<DeclaredOps>,
) => GatedFilterGroup<DeclaredOps>

export function assertNormalisedFilter(schema: AnySchema, group: FilterGroup): void {
	const allFields = schema.fields as Record<string, unknown>
	const fieldNames = new Set(Object.keys(allFields))
	const errors: Array<{ field: string; cause: string }> = []

	function walk(node: FilterChild): void {
		if (node instanceof Filter) {
			if (!fieldNames.has(node.field)) {
				errors.push({ field: node.field, cause: `Unknown field "${node.field}" on schema "${schema.name}"` })
			}
		} else if (node instanceof FilterGroup) {
			for (const child of node.children) walk(child)
		}
	}

	for (const child of group.children) walk(child)

	if (errors.length > 0) {
		throw new OrmValidationError(
			`Filter references unknown field(s) on schema "${schema.name}": ${errors.map((e) => e.field).join(', ')}`,
			'validation',
			schema.name,
			'filter',
			errors.map((e) => ({ field: e.field, cause: e.cause })),
		)
	}
}

if (import.meta.vitest) {
	const { describe, test, expect } = import.meta.vitest
	const { v } = await import('valleyed')
	const { defineSchema } = await import('./schema')

	const UserSchema = defineSchema('users', (s) =>
		s
			.pk('id', v.string(), () => 'u1')
			.field('email', v.string())
			.field('age', v.number())
			.field('name', v.string())
			.field('tags', v.array(v.string())),
	)

	describe('FilterGroup', () => {
		describe('filter-op methods', () => {
			test('eq adds a filter clause with op eq', () => {
				const g = FilterGroup.create().eq(UserSchema.fields.age, 25)
				expect(g.children).toHaveLength(1)
				const f = g.children[0] as Filter
				expect(f.field).toBe('age')
				expect(f.op).toBe('eq')
				expect(f.value).toBe(25)
			})

			test('ne adds a filter clause with op ne', () => {
				const g = FilterGroup.create().ne('name', 'Bob')
				const f = g.children[0] as Filter
				expect(f.op).toBe('ne')
				expect(f.value).toBe('Bob')
			})

			test('gt/gte/lt/lte produce correct ops', () => {
				const g = FilterGroup.create()
					.gt(UserSchema.fields.age, 10)
					.gte(UserSchema.fields.age, 20)
					.lt(UserSchema.fields.age, 30)
					.lte(UserSchema.fields.age, 40)
				expect(g.children.map((c) => (c as Filter).op)).toEqual(['gt', 'gte', 'lt', 'lte'])
			})

			test('in adds a filter clause with array value', () => {
				const g = FilterGroup.create().in(UserSchema.fields.age, [1, 2, 3])
				const f = g.children[0] as Filter
				expect(f.op).toBe('in')
				expect(f.value).toEqual([1, 2, 3])
			})

			test('notIn adds a filter clause with op notIn', () => {
				const g = FilterGroup.create().notIn(UserSchema.fields.age, [4, 5])
				const f = g.children[0] as Filter
				expect(f.op).toBe('notIn')
				expect(f.value).toEqual([4, 5])
			})

			test('like adds a filter clause with op like', () => {
				const g = FilterGroup.create().like(UserSchema.fields.email, 'alice')
				const f = g.children[0] as Filter
				expect(f.op).toBe('like')
				expect(f.value).toBe('alice')
			})

			test('exists adds a filter clause with op exists', () => {
				const g = FilterGroup.create().exists(UserSchema.fields.name)
				const f = g.children[0] as Filter
				expect(f.op).toBe('exists')
			})

			test('notExists is its own op, not a boolean form of exists', () => {
				const g = FilterGroup.create().notExists(UserSchema.fields.name)
				const f = g.children[0] as Filter
				expect(f.op).toBe('notExists')
				expect(f.op).not.toBe('exists')
			})

			test('contains/notContains produce correct ops', () => {
				const g = FilterGroup.create()
					.contains('tags', ['a'])
					.notContains('tags', ['b'])
				expect((g.children[0] as Filter).op).toBe('contains')
				expect((g.children[1] as Filter).op).toBe('notContains')
			})

			test('all 13 filter ops produce matching Filter.op values (name-parity)', () => {
				const g = FilterGroup.create()
					.eq('f', 1)
					.ne('f', 1)
					.gt('f', 1)
					.gte('f', 1)
					.lt('f', 1)
					.lte('f', 1)
					.in('f', [1])
					.notIn('f', [1])
					.like('f', 'x')
					.exists('f')
					.notExists('f')
					.contains('f', [1])
					.notContains('f', [1])
				const ops = g.children.map((c) => (c as Filter).op)
				expect(ops).toEqual([
					'eq', 'ne', 'gt', 'gte', 'lt', 'lte',
					'in', 'notIn', 'like', 'exists', 'notExists',
					'contains', 'notContains',
				])
			})
		})

		describe('raw-string field overload', () => {
			test('accepts raw string field name', () => {
				const g = FilterGroup.create().eq('age', 18)
				const f = g.children[0] as Filter
				expect(f.field).toBe('age')
			})

			test('accepts typed Field ref and extracts field name', () => {
				const g = FilterGroup.create().eq(UserSchema.fields.age, 18)
				const f = g.children[0] as Filter
				expect(f.field).toBe('age')
			})
		})

		describe('structural combinators', () => {
			test('and() creates a nested and-group', () => {
				const g = FilterGroup.create().and([
					(q) => q.eq('age', 10),
					(q) => q.eq('name', 'Alice'),
				])
				expect(g.children).toHaveLength(1)
				const nested = g.children[0] as FilterGroup
				expect(nested.op).toBe('and')
				expect(nested.children).toHaveLength(2)
			})

			test('or() creates a nested or-group', () => {
				const g = FilterGroup.create().or([
					(q) => q.eq('name', 'Alice'),
					(q) => q.eq('name', 'Bob'),
				])
				const nested = g.children[0] as FilterGroup
				expect(nested.op).toBe('or')
			})
		})

		describe('empty-combinator rejection', () => {
			test('and([]) throws at builder time', () => {
				expect(() => FilterGroup.create().and([])).toThrow()
			})

			test('or([]) throws at builder time', () => {
				expect(() => FilterGroup.create().or([])).toThrow()
			})

			test('thrown error has stack pointing at offending call', () => {
				try {
					FilterGroup.create().and([])
					expect.unreachable()
				} catch (e) {
					expect((e as Error).stack).toContain('filter.ts')
				}
			})
		})

		describe('clone()', () => {
			test('deep-clones the tree', () => {
				const original = FilterGroup.create()
					.eq('name', 'Alice')
					.and([(q) => q.gt('age', 20)])
				const cloned = original.clone()

				expect(cloned.children).toHaveLength(2)
				expect(cloned).not.toBe(original)
				expect(cloned.children[0]).not.toBe(original.children[0])
			})

			test('structuredClone of values — mutations on clone do not leak', () => {
				const arr = [1, 2, 3]
				const original = FilterGroup.create().in('ids', arr)
				const cloned = original.clone()

				const clonedValue = (cloned.children[0] as Filter).value as number[]
				clonedValue.push(4)

				expect((original.children[0] as Filter).value).toEqual([1, 2, 3])
				expect(clonedValue).toEqual([1, 2, 3, 4])
			})
		})
	})

	describe('assertNormalisedFilter', () => {
		test('passes for valid filter referencing known fields', () => {
			const g = FilterGroup.create().eq(UserSchema.fields.age, 25)
			expect(() => assertNormalisedFilter(UserSchema, g)).not.toThrow()
		})

		test('passes for raw string field that exists on schema', () => {
			const g = FilterGroup.create().eq('email', 'test@test.com')
			expect(() => assertNormalisedFilter(UserSchema, g)).not.toThrow()
		})

		test('rejects unknown field name with OrmValidationError', () => {
			const g = FilterGroup.create().eq('unknownField', 42)
			expect(() => assertNormalisedFilter(UserSchema, g)).toThrow(OrmValidationError)
		})

		test('rejected error has kind validation', () => {
			const g = FilterGroup.create().eq('badField', 42)
			try {
				assertNormalisedFilter(UserSchema, g)
				expect.unreachable()
			} catch (e) {
				expect(e).toBeInstanceOf(OrmValidationError)
				expect((e as OrmValidationError).kind).toBe('validation')
				expect((e as OrmValidationError).failures).toHaveLength(1)
				expect((e as OrmValidationError).failures[0].field).toBe('badField')
			}
		})

		test('preserves logical field names verbatim for Field refs', () => {
			const g = FilterGroup.create().eq(UserSchema.fields.email, 'a@b.com')
			const f = g.children[0] as Filter
			expect(f.field).toBe('email')
			assertNormalisedFilter(UserSchema, g)
		})

		test('preserves logical field names verbatim for raw-string overloads', () => {
			const g = FilterGroup.create().eq('age', 18)
			const f = g.children[0] as Filter
			expect(f.field).toBe('age')
			assertNormalisedFilter(UserSchema, g)
		})

		test('walks nested groups to detect unknown fields', () => {
			const g = FilterGroup.create().and([
				(q) => q.eq('name', 'Alice'),
				(q) => q.or([(inner) => inner.eq('nonexistent', 'val')]),
			])
			expect(() => assertNormalisedFilter(UserSchema, g)).toThrow(OrmValidationError)
		})
	})
}
