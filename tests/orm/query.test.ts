import { describe, expect, it } from 'vitest'
import {
	and,
	eq,
	exists,
	gt,
	gte,
	isIn,
	like,
	limit,
	lt,
	lte,
	ne,
	notExists,
	notIn,
	offset,
	or,
	orderBy,
	query,
	raw,
	select,
	where,
} from '../../src/orm/query/index'
import { Condition } from '../../src/orm/query/types'

describe('orm/query', () => {
	describe('condition helpers', () => {
		it('eq creates equality condition', () => {
			expect(eq(42)).toEqual({ condition: Condition.eq, value: 42 })
		})

		it('ne creates inequality condition', () => {
			expect(ne('x')).toEqual({ condition: Condition.ne, value: 'x' })
		})

		it('gt creates greater-than condition', () => {
			expect(gt(10)).toEqual({ condition: Condition.gt, value: 10 })
		})

		it('gte creates greater-than-or-equal condition', () => {
			expect(gte(10)).toEqual({ condition: Condition.gte, value: 10 })
		})

		it('lt creates less-than condition', () => {
			expect(lt(5)).toEqual({ condition: Condition.lt, value: 5 })
		})

		it('lte creates less-than-or-equal condition', () => {
			expect(lte(5)).toEqual({ condition: Condition.lte, value: 5 })
		})

		it('isIn creates in-set condition', () => {
			expect(isIn([1, 2, 3])).toEqual({ condition: Condition.in, value: [1, 2, 3] })
		})

		it('notIn creates not-in-set condition', () => {
			expect(notIn(['a', 'b'])).toEqual({ condition: Condition.nin, value: ['a', 'b'] })
		})

		it('like creates pattern condition', () => {
			expect(like('test')).toEqual({ condition: Condition.like, value: 'test' })
		})

		it('exists creates exists condition', () => {
			expect(exists()).toEqual({ condition: Condition.exists, value: true })
		})

		it('notExists creates not-exists condition', () => {
			expect(notExists()).toEqual({ condition: Condition.exists, value: false })
		})
	})

	describe('query operators', () => {
		it('where() creates a where op', () => {
			const op = where('name', eq('John'))
			expect(op).toEqual({
				kind: 'where',
				field: 'name',
				condition: Condition.eq,
				value: 'John',
			})
		})

		it('and() groups clauses', () => {
			const op = and(where('a', eq(1)), where('b', gt(2)))
			expect(op.kind).toBe('and')
			expect(op.clauses).toHaveLength(2)
		})

		it('or() groups clauses', () => {
			const op = or(where('x', eq(1)), where('y', eq(2)))
			expect(op.kind).toBe('or')
			expect(op.clauses).toHaveLength(2)
		})

		it('orderBy() defaults to asc', () => {
			const op = orderBy('name')
			expect(op).toEqual({ kind: 'orderBy', field: 'name', direction: 'asc' })
		})

		it('orderBy() accepts desc', () => {
			const op = orderBy('date', 'desc')
			expect(op).toEqual({ kind: 'orderBy', field: 'date', direction: 'desc' })
		})

		it('limit() creates a limit op', () => {
			expect(limit(10)).toEqual({ kind: 'limit', value: 10 })
		})

		it('offset() creates an offset op', () => {
			expect(offset(20)).toEqual({ kind: 'offset', value: 20 })
		})

		it('select() collects field names', () => {
			const op = select('name', 'email')
			expect(op).toEqual({ kind: 'select', fields: ['name', 'email'] })
		})

		it('raw() wraps arbitrary data', () => {
			const op = raw({ $inc: { count: 1 } })
			expect(op).toEqual({ kind: 'raw', value: { $inc: { count: 1 } } })
		})
	})

	describe('query()', () => {
		it('produces an empty QueryAST with no args', () => {
			const ast = query()
			expect(ast.wheres).toEqual([])
			expect(ast.ands).toEqual([])
			expect(ast.ors).toEqual([])
			expect(ast.orderBys).toEqual([])
			expect(ast.limit).toBeNull()
			expect(ast.offset).toBeNull()
			expect(ast.selects).toEqual([])
			expect(ast.raws).toEqual([])
		})

		it('collects wheres', () => {
			const ast = query(where('a', eq(1)), where('b', gt(2)))
			expect(ast.wheres).toHaveLength(2)
		})

		it('collects ands and ors', () => {
			const ast = query(and(where('x', eq(1))), or(where('y', eq(2)), where('z', eq(3))))
			expect(ast.ands).toHaveLength(1)
			expect(ast.ors).toHaveLength(1)
		})

		it('collects orderBys', () => {
			const ast = query(orderBy('name'), orderBy('date', 'desc'))
			expect(ast.orderBys).toHaveLength(2)
		})

		it('takes last limit and offset', () => {
			const ast = query(limit(10), offset(5), limit(20))
			expect(ast.limit).toBe(20)
			expect(ast.offset).toBe(5)
		})

		it('flattens select fields', () => {
			const ast = query(select('a', 'b'), select('c'))
			expect(ast.selects).toEqual(['a', 'b', 'c'])
		})

		it('collects raw ops', () => {
			const ast = query(raw({ $inc: { x: 1 } }), raw({ $set: { y: 2 } }))
			expect(ast.raws).toHaveLength(2)
		})

		it('compiles a complex query', () => {
			const ast = query(
				where('status', eq('active')),
				and(where('age', gte(18)), where('age', lte(65))),
				or(where('role', eq('admin')), where('role', eq('mod'))),
				orderBy('name'),
				limit(10),
				offset(0),
				select('name', 'email'),
			)

			expect(ast.wheres).toHaveLength(1)
			expect(ast.ands).toHaveLength(1)
			expect(ast.ors).toHaveLength(1)
			expect(ast.orderBys).toHaveLength(1)
			expect(ast.limit).toBe(10)
			expect(ast.offset).toBe(0)
			expect(ast.selects).toEqual(['name', 'email'])
		})
	})
})
