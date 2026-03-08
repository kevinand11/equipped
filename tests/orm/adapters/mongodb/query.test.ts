import { describe, expect, it } from 'vitest'
import { compileMongoQuery, compileMongoUpdate } from '../../../../src/orm/adapters/mongodb/query'
import {
	and,
	contains,
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
	notContains,
	notExists,
	notIn,
	offset,
	or,
	orderBy,
	query,
	select,
	where,
} from '../../../../src/orm/query'

describe('orm/adapters/mongo/query-compiler', () => {
	describe('compileMongoQuery()', () => {
		it('compiles an empty AST', () => {
			const result = compileMongoQuery(query(), '_id')
			expect(result.filter).toEqual({})
			expect(result.sort).toBeUndefined()
			expect(result.limit).toBeUndefined()
			expect(result.skip).toBeUndefined()
			expect(result.projection).toBeUndefined()
		})

		it('compiles a single where eq', () => {
			const ast = query(where('name', eq('John')))
			const result = compileMongoQuery(ast, '_id')
			expect(result.filter).toEqual({ name: { $eq: 'John' } })
		})

		it('compiles where ne', () => {
			const ast = query(where('status', ne('deleted')))
			const result = compileMongoQuery(ast, '_id')
			expect(result.filter).toEqual({ status: { $ne: 'deleted' } })
		})

		it('compiles where gt', () => {
			const ast = query(where('age', gt(18)))
			const result = compileMongoQuery(ast, '_id')
			expect(result.filter).toEqual({ age: { $gt: 18 } })
		})

		it('compiles where gte', () => {
			const ast = query(where('score', gte(90)))
			const result = compileMongoQuery(ast, '_id')
			expect(result.filter).toEqual({ score: { $gte: 90 } })
		})

		it('compiles where lt', () => {
			const ast = query(where('age', lt(5)))
			const result = compileMongoQuery(ast, '_id')
			expect(result.filter).toEqual({ age: { $lt: 5 } })
		})

		it('compiles where lte', () => {
			const ast = query(where('score', lte(50)))
			const result = compileMongoQuery(ast, '_id')
			expect(result.filter).toEqual({ score: { $lte: 50 } })
		})

		it('compiles where in', () => {
			const ast = query(where('role', isIn(['admin', 'mod'])))
			const result = compileMongoQuery(ast, '_id')
			expect(result.filter).toEqual({ role: { $in: ['admin', 'mod'] } })
		})

		it('compiles where nin', () => {
			const ast = query(where('status', notIn(['banned'])))
			const result = compileMongoQuery(ast, '_id')
			expect(result.filter).toEqual({ status: { $nin: ['banned'] } })
		})

		it('compiles where like to $regex', () => {
			const ast = query(where('name', like('john')))
			const result = compileMongoQuery(ast, '_id')
			expect(result.filter.name).toBeDefined()
			const regexFilter = result.filter.name as Record<string, unknown>
			expect(regexFilter.$regex).toBeInstanceOf(RegExp)
			expect((regexFilter.$regex as RegExp).test('John Doe')).toBe(true)
		})

		it('compiles where exists', () => {
			const ast = query(where('email', exists()))
			const result = compileMongoQuery(ast, '_id')
			expect(result.filter).toEqual({ email: { $exists: true } })
		})

		it('compiles where notExists', () => {
			const ast = query(where('email', notExists()))
			const result = compileMongoQuery(ast, '_id')
			expect(result.filter).toEqual({ email: { $exists: false } })
		})

		it('compiles where contains', () => {
			const ast = query(where('tags', contains(['featured'])))
			const result = compileMongoQuery(ast, '_id')
			expect(result.filter).toEqual({ tags: { $all: ['featured'] } })
		})

		it('compiles where notContains', () => {
			const ast = query(where('tags', notContains(['featured'])))
			const result = compileMongoQuery(ast, '_id')
			expect(result.filter).toEqual({ tags: { $not: { $all: ['featured'] } } })
		})

		it('maps id field to _id when primaryKey is _id', () => {
			const ast = query(where('id', eq('abc')))
			const result = compileMongoQuery(ast, '_id')
			expect(result.filter).toEqual({ _id: { $eq: 'abc' } })
		})

		it('does not map id when primaryKey is id', () => {
			const ast = query(where('id', eq('abc')))
			const result = compileMongoQuery(ast, 'id')
			expect(result.filter).toEqual({ id: { $eq: 'abc' } })
		})

		it('compiles multiple wheres with implicit AND', () => {
			const ast = query(where('a', eq(1)), where('b', gt(2)))
			const result = compileMongoQuery(ast, '_id')
			expect(result.filter).toEqual({
				$and: [{ a: { $eq: 1 } }, { b: { $gt: 2 } }],
			})
		})

		it('compiles and() clause', () => {
			const ast = query(and(where('x', eq(1)), where('y', eq(2))))
			const result = compileMongoQuery(ast, '_id')
			expect(result.filter).toEqual({
				$and: [{ x: { $eq: 1 } }, { y: { $eq: 2 } }],
			})
		})

		it('compiles or() clause', () => {
			const ast = query(or(where('role', eq('admin')), where('role', eq('mod'))))
			const result = compileMongoQuery(ast, '_id')
			expect(result.filter).toEqual({
				$or: [{ role: { $eq: 'admin' } }, { role: { $eq: 'mod' } }],
			})
		})

		it('compiles nested and + or', () => {
			const ast = query(and(where('status', eq('active')), or(where('role', eq('admin')), where('role', eq('mod')))))
			const result = compileMongoQuery(ast, '_id')
			expect(result.filter).toEqual({
				$and: [{ status: { $eq: 'active' } }, { $or: [{ role: { $eq: 'admin' } }, { role: { $eq: 'mod' } }] }],
			})
		})

		it('compiles sort', () => {
			const ast = query(orderBy('name'), orderBy('date', 'desc'))
			const result = compileMongoQuery(ast, '_id')
			expect(result.sort).toEqual({ name: 1, date: -1 })
		})

		it('compiles limit and skip', () => {
			const ast = query(limit(10), offset(5))
			const result = compileMongoQuery(ast, '_id')
			expect(result.limit).toBe(10)
			expect(result.skip).toBe(5)
		})

		it('compiles projection from select', () => {
			const ast = query(select('name', 'email'))
			const result = compileMongoQuery(ast, '_id')
			expect(result.projection).toEqual({ name: 1, email: 1 })
		})

		it('maps id in sort/select to _id when primaryKey is _id', () => {
			const ast = query(orderBy('id'), select('id', 'name'))
			const result = compileMongoQuery(ast, '_id')
			expect(result.sort).toEqual({ _id: 1 })
			expect(result.projection).toEqual({ _id: 1, name: 1 })
		})

		it('compiles a complex query end-to-end', () => {
			const ast = query(
				where('status', eq('active')),
				and(where('age', gte(18)), where('age', lte(65))),
				or(where('role', eq('admin')), where('role', eq('mod'))),
				orderBy('name'),
				orderBy('createdAt', 'desc'),
				limit(20),
				offset(40),
				select('name', 'email', 'role'),
			)
			const result = compileMongoQuery(ast, '_id')

			expect(result.filter.$and).toBeDefined()
			expect(result.sort).toEqual({ name: 1, createdAt: -1 })
			expect(result.limit).toBe(20)
			expect(result.skip).toBe(40)
			expect(result.projection).toEqual({ name: 1, email: 1, role: 1 })
		})
	})

	describe('compileMongoUpdate()', () => {
		it('compiles simple data to $set', () => {
			const now = new Date(2024, 0, 1)
			const result = compileMongoUpdate({ name: 'Jane' }, [], now)
			expect(result.$set).toEqual({ name: 'Jane', updatedAt: now.getTime() })
		})

		it('merges raw $set with data', () => {
			const now = new Date(2024, 0, 1)
			const result = compileMongoUpdate({ name: 'Jane' }, [{ $set: { extra: true } }], now)
			expect(result.$set).toEqual({
				name: 'Jane',
				updatedAt: now.getTime(),
				extra: true,
			})
		})

		it('passes through raw operators like $inc', () => {
			const now = new Date(2024, 0, 1)
			const result = compileMongoUpdate({}, [{ $inc: { count: 1 } }], now)
			expect(result.$inc).toEqual({ count: 1 })
			expect(result.$set).toEqual({ updatedAt: now.getTime() })
		})

		it('handles empty data with updatedAt', () => {
			const now = new Date(2024, 0, 1)
			const result = compileMongoUpdate({}, [], now)
			expect(result).toEqual({})
		})

		it('handles multiple raw operators', () => {
			const now = new Date(2024, 0, 1)
			const result = compileMongoUpdate({ name: 'X' }, [{ $inc: { a: 1 } }, { $push: { tags: 'new' } }], now)
			expect(result.$set).toEqual({ name: 'X', updatedAt: now.getTime() })
			expect(result.$inc).toEqual({ a: 1 })
			expect(result.$push).toEqual({ tags: 'new' })
		})
	})
})
