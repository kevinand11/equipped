import { describe, expect, it } from 'vitest'
import {
	buildCountQuery,
	buildDeleteQuery,
	buildInsertQuery,
	buildSelectQuery,
	buildUpdateQuery,
	compilePgQuery,
} from '../../../../src/orm/adapters/pg/query-compiler'
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
} from '../../../../src/orm/query/index'

describe('orm/adapters/pg/query-compiler', () => {
	describe('compilePgQuery()', () => {
		it('compiles an empty AST', () => {
			const result = compilePgQuery(query(), 'users', 'id')
			expect(result.whereClause).toBe('')
			expect(result.orderClause).toBe('')
			expect(result.limitClause).toBe('')
			expect(result.offsetClause).toBe('')
			expect(result.selectClause).toBe('*')
			expect(result.params).toEqual([])
		})

		it('compiles where eq', () => {
			const ast = query(where('name', eq('John')))
			const result = compilePgQuery(ast, 'users', 'id')
			expect(result.whereClause).toBe('WHERE "name" = $1')
			expect(result.params).toEqual(['John'])
		})

		it('compiles where eq null to IS NULL', () => {
			const ast = query(where('email', eq(null)))
			const result = compilePgQuery(ast, 'users', 'id')
			expect(result.whereClause).toBe('WHERE "email" IS NULL')
			expect(result.params).toEqual([])
		})

		it('compiles where ne', () => {
			const ast = query(where('status', ne('deleted')))
			const result = compilePgQuery(ast, 'users', 'id')
			expect(result.whereClause).toBe('WHERE "status" != $1')
			expect(result.params).toEqual(['deleted'])
		})

		it('compiles where ne null to IS NOT NULL', () => {
			const ast = query(where('email', ne(null)))
			const result = compilePgQuery(ast, 'users', 'id')
			expect(result.whereClause).toBe('WHERE "email" IS NOT NULL')
		})

		it('compiles where gt', () => {
			const ast = query(where('age', gt(18)))
			const result = compilePgQuery(ast, 'users', 'id')
			expect(result.whereClause).toBe('WHERE "age" > $1')
			expect(result.params).toEqual([18])
		})

		it('compiles where gte', () => {
			const ast = query(where('score', gte(90)))
			const result = compilePgQuery(ast, 'users', 'id')
			expect(result.whereClause).toBe('WHERE "score" >= $1')
			expect(result.params).toEqual([90])
		})

		it('compiles where lt', () => {
			const ast = query(where('age', lt(5)))
			const result = compilePgQuery(ast, 'users', 'id')
			expect(result.whereClause).toBe('WHERE "age" < $1')
			expect(result.params).toEqual([5])
		})

		it('compiles where lte', () => {
			const ast = query(where('score', lte(50)))
			const result = compilePgQuery(ast, 'users', 'id')
			expect(result.whereClause).toBe('WHERE "score" <= $1')
			expect(result.params).toEqual([50])
		})

		it('compiles where in using ANY', () => {
			const ast = query(where('role', isIn(['admin', 'mod'])))
			const result = compilePgQuery(ast, 'users', 'id')
			expect(result.whereClause).toBe('WHERE "role" = ANY($1)')
			expect(result.params).toEqual([['admin', 'mod']])
		})

		it('compiles where nin using NOT ANY', () => {
			const ast = query(where('status', notIn(['banned'])))
			const result = compilePgQuery(ast, 'users', 'id')
			expect(result.whereClause).toBe('WHERE NOT ("status" = ANY($1))')
			expect(result.params).toEqual([['banned']])
		})

		it('compiles where like to ILIKE', () => {
			const ast = query(where('name', like('john')))
			const result = compilePgQuery(ast, 'users', 'id')
			expect(result.whereClause).toBe('WHERE "name" ILIKE $1')
			expect(result.params).toEqual(['%john%'])
		})

		it('compiles where exists to IS NOT NULL', () => {
			const ast = query(where('email', exists()))
			const result = compilePgQuery(ast, 'users', 'id')
			expect(result.whereClause).toBe('WHERE "email" IS NOT NULL')
		})

		it('compiles where notExists to IS NULL', () => {
			const ast = query(where('email', notExists()))
			const result = compilePgQuery(ast, 'users', 'id')
			expect(result.whereClause).toBe('WHERE "email" IS NULL')
		})

		it('compiles where contains to @>', () => {
			const ast = query(where('tags', contains(['featured'])))
			const result = compilePgQuery(ast, 'users', 'id')
			expect(result.whereClause).toBe('WHERE "tags" @> $1::jsonb')
			expect(result.params).toEqual(['["featured"]'])
		})

		it('compiles where notContains to NOT @>', () => {
			const ast = query(where('tags', notContains(['featured'])))
			const result = compilePgQuery(ast, 'users', 'id')
			expect(result.whereClause).toBe('WHERE NOT ("tags" @> $1::jsonb)')
			expect(result.params).toEqual(['["featured"]'])
		})

		it('compiles multiple wheres with AND', () => {
			const ast = query(where('a', eq(1)), where('b', gt(2)))
			const result = compilePgQuery(ast, 'users', 'id')
			expect(result.whereClause).toBe('WHERE "a" = $1 AND "b" > $2')
			expect(result.params).toEqual([1, 2])
		})

		it('compiles and() clause', () => {
			const ast = query(and(where('x', eq(1)), where('y', eq(2))))
			const result = compilePgQuery(ast, 'users', 'id')
			expect(result.whereClause).toBe('WHERE ("x" = $1 AND "y" = $2)')
			expect(result.params).toEqual([1, 2])
		})

		it('compiles or() clause', () => {
			const ast = query(or(where('a', eq(1)), where('b', eq(2))))
			const result = compilePgQuery(ast, 'users', 'id')
			expect(result.whereClause).toBe('WHERE ("a" = $1 OR "b" = $2)')
			expect(result.params).toEqual([1, 2])
		})

		it('compiles nested and + or', () => {
			const ast = query(and(where('status', eq('active')), or(where('role', eq('admin')), where('role', eq('mod')))))
			const result = compilePgQuery(ast, 'users', 'id')
			expect(result.whereClause).toBe('WHERE ("status" = $1 AND ("role" = $2 OR "role" = $3))')
			expect(result.params).toEqual(['active', 'admin', 'mod'])
		})

		it('compiles order by', () => {
			const ast = query(orderBy('name'), orderBy('date', 'desc'))
			const result = compilePgQuery(ast, 'users', 'id')
			expect(result.orderClause).toBe('ORDER BY "name" ASC, "date" DESC')
		})

		it('compiles limit and offset with params', () => {
			const ast = query(limit(10), offset(5))
			const result = compilePgQuery(ast, 'users', 'id')
			expect(result.limitClause).toBe('LIMIT $1')
			expect(result.offsetClause).toBe('OFFSET $2')
			expect(result.params).toEqual([10, 5])
		})

		it('compiles select fields', () => {
			const ast = query(select('name', 'email'))
			const result = compilePgQuery(ast, 'users', 'id')
			expect(result.selectClause).toBe('"name", "email"')
		})

		it('parameter indices increment correctly across clauses', () => {
			const ast = query(where('status', eq('active')), where('age', gt(18)), limit(10), offset(0))
			const result = compilePgQuery(ast, 'users', 'id')
			expect(result.params).toEqual(['active', 18, 10, 0])
			expect(result.whereClause).toBe('WHERE "status" = $1 AND "age" > $2')
			expect(result.limitClause).toBe('LIMIT $3')
			expect(result.offsetClause).toBe('OFFSET $4')
		})
	})

	describe('buildSelectQuery()', () => {
		it('builds a basic SELECT', () => {
			const ast = query(where('status', eq('active')))
			const result = buildSelectQuery(ast, 'users', 'id')
			expect(result.sql).toBe('SELECT * FROM "users" WHERE "status" = $1')
			expect(result.params).toEqual(['active'])
		})

		it('builds SELECT with all clauses', () => {
			const ast = query(where('a', eq(1)), orderBy('name'), limit(10), offset(5), select('name', 'email'))
			const result = buildSelectQuery(ast, 'users', 'id')
			expect(result.sql).toBe('SELECT "name", "email" FROM "users" WHERE "a" = $1 ORDER BY "name" ASC LIMIT $2 OFFSET $3')
			expect(result.params).toEqual([1, 10, 5])
		})

		it('builds SELECT with no WHERE', () => {
			const ast = query()
			const result = buildSelectQuery(ast, 'items', 'id')
			expect(result.sql).toBe('SELECT * FROM "items"')
			expect(result.params).toEqual([])
		})
	})

	describe('buildCountQuery()', () => {
		it('builds COUNT with WHERE', () => {
			const ast = query(where('status', eq('active')))
			const result = buildCountQuery(ast, 'users', 'id')
			expect(result.sql).toBe('SELECT COUNT(*) as count FROM "users" WHERE "status" = $1')
			expect(result.params).toEqual(['active'])
		})

		it('builds COUNT without WHERE', () => {
			const result = buildCountQuery(query(), 'users', 'id')
			expect(result.sql).toBe('SELECT COUNT(*) as count FROM "users"')
		})
	})

	describe('buildInsertQuery()', () => {
		it('builds INSERT with returning', () => {
			const result = buildInsertQuery('users', { name: 'John', age: 30 })
			expect(result.sql).toBe('INSERT INTO "users" ("name", "age") VALUES ($1, $2) RETURNING *')
			expect(result.params).toEqual(['John', 30])
		})

		it('handles single column insert', () => {
			const result = buildInsertQuery('tags', { label: 'test' })
			expect(result.sql).toBe('INSERT INTO "tags" ("label") VALUES ($1) RETURNING *')
			expect(result.params).toEqual(['test'])
		})
	})

	describe('buildUpdateQuery()', () => {
		it('builds UPDATE with WHERE', () => {
			const ast = query(where('id', eq('abc')))
			const result = buildUpdateQuery(ast, 'users', 'id', { name: 'Jane' })
			expect(result.sql).toMatch(/^UPDATE "users" SET "name" = \$1 WHERE "id" = \$2 RETURNING \*$/)
			expect(result.params).toEqual(['Jane', 'abc'])
		})

		it('builds UPDATE with multiple SET fields', () => {
			const ast = query(where('status', eq('active')))
			const result = buildUpdateQuery(ast, 'users', 'id', { name: 'X', age: 25 })
			expect(result.sql).toMatch(/SET "name" = \$1, "age" = \$2/)
			expect(result.params[0]).toBe('X')
			expect(result.params[1]).toBe(25)
		})
	})

	describe('buildDeleteQuery()', () => {
		it('builds DELETE with WHERE', () => {
			const ast = query(where('id', eq('abc')))
			const result = buildDeleteQuery(ast, 'users', 'id')
			expect(result.sql).toBe('DELETE FROM "users" WHERE "id" = $1 RETURNING *')
			expect(result.params).toEqual(['abc'])
		})

		it('builds DELETE without WHERE', () => {
			const result = buildDeleteQuery(query(), 'users', 'id')
			expect(result.sql).toBe('DELETE FROM "users" RETURNING *')
		})
	})
})
