import { v } from 'valleyed'
import { describe, expect, test, vi } from 'vitest'

import { Conditions, QueryKeys, queryParamsPipe, wrapQueryParams } from '../../src/dbs/pipes'

// Mock Instance.get() to return proper settings for tests
vi.mock('../../src/instance', async () => {
	const actual = await vi.importActual('../../src/instance')
	return {
		...actual,
		Instance: {
			get: () => ({
				settings: {
					utils: {
						paginationDefaultLimit: 100,
					},
				},
			}),
			crash: (error: Error) => {
				throw error
			},
		},
	}
})

describe('dbs/pipes', () => {
	describe('Conditions enum', () => {
		test('should have all comparison conditions', () => {
			expect(Conditions.lt).toBe('lt')
			expect(Conditions.lte).toBe('lte')
			expect(Conditions.gt).toBe('gt')
			expect(Conditions.gte).toBe('gte')
			expect(Conditions.eq).toBe('eq')
			expect(Conditions.ne).toBe('ne')
			expect(Conditions.in).toBe('in')
			expect(Conditions.nin).toBe('nin')
		})

		test('should contain exactly 8 conditions', () => {
			expect(Object.keys(Conditions)).toHaveLength(8)
		})
	})

	describe('QueryKeys enum', () => {
		test('should have and/or keys', () => {
			expect(QueryKeys.and).toBe('and')
			expect(QueryKeys.or).toBe('or')
		})

		test('should contain exactly 2 keys', () => {
			expect(Object.keys(QueryKeys)).toHaveLength(2)
		})
	})

	describe('queryParamsPipe', () => {
		test('should validate with default values', () => {
			const pipe = queryParamsPipe()
			const result = v.validate(pipe, {})

			expect(result.valid).toBe(true)
			if (result.valid) expect(result.value).toEqual({
				all: false,
				limit: 100,
				page: 1,
				search: null,
				sort: [],
				whereType: 'and',
				where: [],
				auth: [],
				authType: 'and',
			})
		})

		test('should accept custom limit within bounds', () => {
			const pipe = queryParamsPipe()
			const result = v.validate(pipe, { limit: 50 })

			expect(result.valid).toBe(true)
			if (result.valid) expect(result.value.limit).toBe(50)
		})

		test('should cap limit at paginationDefaultLimit', () => {
			const pipe = queryParamsPipe()
			const result = v.validate(pipe, { limit: 200 })

			expect(result.valid).toBe(true)
			if (result.valid) expect(result.value.limit).toBe(100) // capped to default
		})

		test('should accept page number', () => {
			const pipe = queryParamsPipe()
			const result = v.validate(pipe, { page: 5 })

			expect(result.valid).toBe(true)
			if (result.valid) expect(result.value.page).toBe(5)
		})

		test('should default page to 1 for invalid values', () => {
			const pipe = queryParamsPipe()
			const result = v.validate(pipe, { page: 0 })

			expect(result.valid).toBe(true)
			if (result.valid) expect(result.value.page).toBe(1)
		})

		test('should accept all flag', () => {
			const pipe = queryParamsPipe()
			const result = v.validate(pipe, { all: true })

			expect(result.valid).toBe(true)
			if (result.valid) expect(result.value.all).toBe(true)
		})

		test('should validate search object', () => {
			const pipe = queryParamsPipe()
			const result = v.validate(pipe, {
				search: { value: 'test', fields: ['name', 'email'] },
			})

			expect(result.valid).toBe(true)
			if (result.valid) expect(result.value.search).toEqual({ value: 'test', fields: ['name', 'email'] })
		})

		test('should validate sort array', () => {
			const pipe = queryParamsPipe()
			const result = v.validate(pipe, {
				sort: [
					{ field: 'createdAt', desc: true },
					{ field: 'name', desc: false },
				],
			})

			expect(result.valid).toBe(true)
			if (result.valid) expect(result.value.sort).toEqual([
				{ field: 'createdAt', desc: true },
				{ field: 'name', desc: false },
			])
		})

		test('should default sort desc to false', () => {
			const pipe = queryParamsPipe()
			const result = v.validate(pipe, {
				sort: [{ field: 'name' }],
			})

			expect(result.valid).toBe(true)
			if (result.valid) expect(result.value.sort).toEqual([{ field: 'name', desc: false }])
		})

		test('should validate simple where clause', () => {
			const pipe = queryParamsPipe()
			const result = v.validate(pipe, {
				where: [{ field: 'status', value: 'active', condition: 'eq' }],
			})

			expect(result.valid).toBe(true)
			if (result.valid) expect(result.value.where).toEqual([{ field: 'status', value: 'active', condition: 'eq' }])
		})

		test('should default where condition to eq', () => {
			const pipe = queryParamsPipe()
			const result = v.validate(pipe, {
				where: [{ field: 'status', value: 'active' }],
			})

			expect(result.valid).toBe(true)
			if (result.valid) expect(result.value.where[0].condition).toBe('eq')
		})

		test('should validate nested where blocks (and/or)', () => {
			const pipe = queryParamsPipe()
			const result = v.validate(pipe, {
				where: [
					{
						condition: 'or',
						value: [
							{ field: 'status', value: 'active' },
							{ field: 'status', value: 'pending' },
						],
					},
				],
			})

			expect(result.valid).toBe(true)
			if (result.valid) expect(result.value.where).toEqual([
				{
					condition: 'or',
					value: [
						{ field: 'status', value: 'active', condition: 'eq' },
						{ field: 'status', value: 'pending', condition: 'eq' },
					],
				},
			])
		})

		test('should validate whereType', () => {
			const pipe = queryParamsPipe()
			const resultAnd = v.validate(pipe, { whereType: 'and' })
			const resultOr = v.validate(pipe, { whereType: 'or' })

			expect(resultAnd.valid).toBe(true)
			if (resultAnd.valid) expect(resultAnd.value.whereType).toBe('and')
			expect(resultOr.valid).toBe(true)
			if (resultOr.valid) expect(resultOr.value.whereType).toBe('or')
		})

		test('should validate different conditions', () => {
			const pipe = queryParamsPipe()
			const conditions = ['lt', 'lte', 'gt', 'gte', 'eq', 'ne', 'in', 'nin'] as const

			for (const condition of conditions) {
				const result = v.validate(pipe, {
					where: [{ field: 'count', value: 10, condition }],
				})

				expect(result.valid).toBe(true)
				if (result.valid) expect(result.value.where[0].condition).toBe(condition)
			}
		})

		test('should validate select array', () => {
			const pipe = queryParamsPipe()
			const result = v.validate(pipe, {
				select: ['name', 'email', 'createdAt'],
			})

			expect(result.valid).toBe(true)
			if (result.valid) expect(result.value.select).toEqual(['name', 'email', 'createdAt'])
		})

		test('should allow undefined select', () => {
			const pipe = queryParamsPipe()
			const result = v.validate(pipe, {})

			expect(result.valid).toBe(true)
			if (result.valid) expect(result.value.select).toBeUndefined()
		})
	})

	describe('wrapQueryParams', () => {
		test('should wrap valid params', () => {
			const result = wrapQueryParams({
				limit: 10,
				page: 2,
			})

			expect(result.limit).toBe(10)
			expect(result.page).toBe(2)
			expect(result.all).toBe(false)
		})

		test('should apply defaults to empty object', () => {
			const result = wrapQueryParams({})

			expect(result.limit).toBe(100)
			expect(result.page).toBe(1)
			expect(result.all).toBe(false)
			expect(result.where).toEqual([])
			expect(result.sort).toEqual([])
		})

		test('should include auth fields', () => {
			const result = wrapQueryParams({})

			expect(result.auth).toEqual([])
			expect(result.authType).toBe('and')
		})
	})
})
