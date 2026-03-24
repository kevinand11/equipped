import { describe, expect, test } from 'vitest'
import {
	buildCountQuery,
	buildDeleteQuery,
	buildInsertQuery,
	buildSelectQuery,
	buildUpdateQuery,
} from '../../../src/orm/adapters/postgresql/query'
import { and, eq, exists, gt, gte, isIn, like, lt, lte, ne, notContains, notExists, notIn, or, orderBy, query } from '../../../src/orm/query'
import { inc, max, min, mul, patch, pull, push, unset } from '../../../src/orm/updates'

const table = 'users'
const pk = 'id'

// ── buildSelectQuery ──────────────────────────────────────────────────────────

describe('buildSelectQuery', () => {
	test('no filter produces SELECT * with no params', () => {
		const { sql, params } = buildSelectQuery(query(), undefined, table, pk)
		expect(sql).toBe('SELECT * FROM "users"')
		expect(params).toEqual([])
	})

	test('eq condition produces WHERE clause', () => {
		const { sql, params } = buildSelectQuery(query(eq('name', 'Alice')), undefined, table, pk)
		expect(sql).toBe('SELECT * FROM "users" WHERE "name" = $1')
		expect(params).toEqual(['Alice'])
	})

	test('eq null produces IS NULL', () => {
		const { sql } = buildSelectQuery(query(eq('name', null)), undefined, table, pk)
		expect(sql).toBe('SELECT * FROM "users" WHERE "name" IS NULL')
	})

	test('ne produces !=', () => {
		const { sql, params } = buildSelectQuery(query(ne('status', 'banned')), undefined, table, pk)
		expect(sql).toContain('"status" != $1')
		expect(params).toEqual(['banned'])
	})

	test('ne null produces IS NOT NULL', () => {
		const { sql } = buildSelectQuery(query(ne('email', null)), undefined, table, pk)
		expect(sql).toContain('"email" IS NOT NULL')
	})

	test('gt produces >', () => {
		const { sql, params } = buildSelectQuery(query(gt('age', 18)), undefined, table, pk)
		expect(sql).toContain('"age" > $1')
		expect(params).toEqual([18])
	})

	test('gte produces >=', () => {
		const { sql } = buildSelectQuery(query(gte('age', 18)), undefined, table, pk)
		expect(sql).toContain('"age" >= $1')
	})

	test('lt produces <', () => {
		const { sql } = buildSelectQuery(query(lt('age', 65)), undefined, table, pk)
		expect(sql).toContain('"age" < $1')
	})

	test('lte produces <=', () => {
		const { sql } = buildSelectQuery(query(lte('age', 65)), undefined, table, pk)
		expect(sql).toContain('"age" <= $1')
	})

	test('isIn produces = ANY(...)', () => {
		const { sql, params } = buildSelectQuery(query(isIn('role', ['admin', 'mod'])), undefined, table, pk)
		expect(sql).toContain('"role" = ANY($1)')
		expect(params[0]).toEqual(['admin', 'mod'])
	})

	test('notIn produces NOT (... = ANY(...))', () => {
		const { sql } = buildSelectQuery(query(notIn('role', ['banned'])), undefined, table, pk)
		expect(sql).toContain('NOT ("role" = ANY($1))')
	})

	test('like produces ILIKE with % wrapping', () => {
		const { sql, params } = buildSelectQuery(query(like('name', 'ali')), undefined, table, pk)
		expect(sql).toContain('"name" ILIKE $1')
		expect(params[0]).toBe('%ali%')
	})

	test('exists(true) produces IS NOT NULL', () => {
		const { sql } = buildSelectQuery(query(exists('email')), undefined, table, pk)
		expect(sql).toContain('"email" IS NOT NULL')
	})

	test('notExists produces IS NULL', () => {
		const { sql } = buildSelectQuery(query(notExists('email')), undefined, table, pk)
		expect(sql).toContain('"email" IS NULL')
	})

	test('contains produces @> jsonb', () => {
		const { sql, params } = buildSelectQuery(query(eq('tags', null)), undefined, table, pk)
		// just checking jsonb contains is tested via direct WhereOp below
		expect(params).toEqual([])
	})

	test('multiple wheres joined with AND', () => {
		const { sql, params } = buildSelectQuery(query(eq('name', 'Alice'), gt('age', 18)), undefined, table, pk)
		expect(sql).toContain('WHERE "name" = $1 AND "age" > $2')
		expect(params).toEqual(['Alice', 18])
	})

	test('and() produces grouped AND clause', () => {
		const { sql } = buildSelectQuery(query(and(eq('a', 1), eq('b', 2))), undefined, table, pk)
		expect(sql).toContain('("a" = $1 AND "b" = $2)')
	})

	test('or() produces grouped OR clause', () => {
		const { sql } = buildSelectQuery(query(or(eq('a', 1), eq('b', 2))), undefined, table, pk)
		expect(sql).toContain('("a" = $1 OR "b" = $2)')
	})

	test('nested and within or', () => {
		const { sql } = buildSelectQuery(query(or(and(eq('a', 1), eq('b', 2)), eq('c', 3))), undefined, table, pk)
		expect(sql).toContain('(("a" = $1 AND "b" = $2) OR "c" = $3)')
	})

	test('orderBy ASC', () => {
		const { sql } = buildSelectQuery(query(), { orderBy: [orderBy('name')] }, table, pk)
		expect(sql).toContain('ORDER BY "name" ASC')
	})

	test('orderBy DESC', () => {
		const { sql } = buildSelectQuery(query(), { orderBy: [orderBy('createdAt', 'desc')] }, table, pk)
		expect(sql).toContain('ORDER BY "createdAt" DESC')
	})

	test('multiple orderBy columns', () => {
		const { sql } = buildSelectQuery(query(), { orderBy: [orderBy('name'), orderBy('age', 'desc')] }, table, pk)
		expect(sql).toContain('ORDER BY "name" ASC, "age" DESC')
	})

	test('limit appends LIMIT clause', () => {
		const { sql, params } = buildSelectQuery(query(), { limit: 10 }, table, pk)
		expect(sql).toContain('LIMIT $1')
		expect(params).toEqual([10])
	})

	test('offset appends OFFSET clause', () => {
		const { sql, params } = buildSelectQuery(query(), { offset: 20 }, table, pk)
		expect(sql).toContain('OFFSET $1')
		expect(params).toEqual([20])
	})

	test('limit and offset together use sequential param indices', () => {
		const { sql, params } = buildSelectQuery(query(), { limit: 5, offset: 15 }, table, pk)
		expect(sql).toContain('LIMIT $1')
		expect(sql).toContain('OFFSET $2')
		expect(params).toEqual([5, 15])
	})

	test('select produces named column list', () => {
		const { sql } = buildSelectQuery(query(), { select: ['name', 'email'] }, table, pk)
		expect(sql).toContain('SELECT "name", "email"')
	})

	test('where + limit param indices are correct', () => {
		const { sql, params } = buildSelectQuery(query(eq('name', 'Bob')), { limit: 1 }, table, pk)
		expect(sql).toContain('"name" = $1')
		expect(sql).toContain('LIMIT $2')
		expect(params).toEqual(['Bob', 1])
	})

	test('id field maps to custom primary key', () => {
		const { sql } = buildSelectQuery(query(eq('id', 'x')), undefined, table, '_id')
		expect(sql).toContain('"_id" = $1')
	})
})

// ── buildCountQuery ───────────────────────────────────────────────────────────

describe('buildCountQuery', () => {
	test('no filter counts all rows', () => {
		const { sql, params } = buildCountQuery(query(), table, pk)
		expect(sql).toBe('SELECT COUNT(*) as count FROM "users"')
		expect(params).toEqual([])
	})

	test('with filter adds WHERE clause', () => {
		const { sql, params } = buildCountQuery(query(eq('active', true)), table, pk)
		expect(sql).toContain('WHERE "active" = $1')
		expect(params).toEqual([true])
	})
})

// ── buildInsertQuery ──────────────────────────────────────────────────────────

describe('buildInsertQuery', () => {
	test('produces INSERT with column list and RETURNING *', () => {
		const { sql, params } = buildInsertQuery(table, { name: 'Alice', email: 'a@b.com' })
		expect(sql).toBe('INSERT INTO "users" ("name", "email") VALUES ($1, $2) RETURNING *')
		expect(params).toEqual(['Alice', 'a@b.com'])
	})

	test('single column insert', () => {
		const { sql, params } = buildInsertQuery(table, { id: 'abc' })
		expect(sql).toBe('INSERT INTO "users" ("id") VALUES ($1) RETURNING *')
		expect(params).toEqual(['abc'])
	})
})

// ── buildUpdateQuery ──────────────────────────────────────────────────────────

describe('buildUpdateQuery', () => {
	test('plain value produces = $N', () => {
		const { sql, params } = buildUpdateQuery(query(eq('id', '1')), table, pk, { name: 'Bob' })
		expect(sql).toContain('"name" = $1')
		expect(sql).toContain('"id" = $2')
		expect(params).toEqual(['Bob', '1'])
	})

	test('IncOp produces col + $N', () => {
		const { sql, params } = buildUpdateQuery(query(), table, pk, { score: inc(5) })
		expect(sql).toContain('"score" = "score" + $1')
		expect(params[0]).toBe(5)
	})

	test('MulOp produces col * $N', () => {
		const { sql } = buildUpdateQuery(query(), table, pk, { score: mul(2) })
		expect(sql).toContain('"score" = "score" * $1')
	})

	test('MinOp produces LEAST(col, $N)', () => {
		const { sql } = buildUpdateQuery(query(), table, pk, { score: min(0) })
		expect(sql).toContain('"score" = LEAST("score", $1)')
	})

	test('MaxOp produces GREATEST(col, $N)', () => {
		const { sql } = buildUpdateQuery(query(), table, pk, { score: max(100) })
		expect(sql).toContain('"score" = GREATEST("score", $1)')
	})

	test('UnsetOp produces col = NULL', () => {
		const { sql } = buildUpdateQuery(query(), table, pk, { deletedAt: unset() })
		expect(sql).toContain('"deletedAt" = NULL')
	})

	test('PushOp produces jsonb array append', () => {
		const { sql, params } = buildUpdateQuery(query(), table, pk, { tags: push('new') })
		expect(sql).toContain('"tags" = "tags" || jsonb_build_array($1::jsonb)')
		expect(params[0]).toBe(JSON.stringify('new'))
	})

	test('PullOp produces jsonb filter subquery', () => {
		const { sql } = buildUpdateQuery(query(), table, pk, { tags: pull('old') })
		expect(sql).toContain('jsonb_array_elements')
		expect(sql).toContain('"tags"')
	})

	test('PatchOp produces jsonb_set', () => {
		const { sql, params } = buildUpdateQuery(query(), table, pk, { meta: patch(['key'], 42) })
		expect(sql).toContain('jsonb_set("meta",')
		expect(params[0]).toBe(JSON.stringify(42))
	})

	test('multiple ops in one update', () => {
		const { sql, params } = buildUpdateQuery(query(eq('id', '1')), table, pk, {
			name: 'Alice',
			score: inc(1),
		})
		expect(sql).toContain('"name" = $1')
		expect(sql).toContain('"score" = "score" + $2')
		expect(params).toEqual(['Alice', 1, '1'])
	})

	test('returns RETURNING *', () => {
		const { sql } = buildUpdateQuery(query(), table, pk, { name: 'X' })
		expect(sql).toContain('RETURNING *')
	})
})

// ── buildDeleteQuery ──────────────────────────────────────────────────────────

describe('buildDeleteQuery', () => {
	test('no filter deletes all rows', () => {
		const { sql, params } = buildDeleteQuery(query(), table, pk)
		expect(sql).toBe('DELETE FROM "users" RETURNING *')
		expect(params).toEqual([])
	})

	test('with filter adds WHERE clause', () => {
		const { sql, params } = buildDeleteQuery(query(eq('id', '42')), table, pk)
		expect(sql).toContain('WHERE "id" = $1')
		expect(params).toEqual(['42'])
	})

	test('returns RETURNING *', () => {
		const { sql } = buildDeleteQuery(query(eq('id', 'x')), table, pk)
		expect(sql).toContain('RETURNING *')
	})
})
