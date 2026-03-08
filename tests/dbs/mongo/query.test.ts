import { describe, expect, test, vi } from 'vitest'

import { parseMongodbQueryParams } from '../../../src/dbs/adapters/mongodb/query'
import { Conditions, QueryKeys, type QueryParamsBase } from '../../../src/dbs/pipes'

// Mock MongoDB Collection
const createMockCollection = (documents: any[] = []) => {
	const cursor = {
		sort: vi.fn().mockReturnThis(),
		limit: vi.fn().mockReturnThis(),
		skip: vi.fn().mockReturnThis(),
		toArray: vi.fn().mockResolvedValue(documents),
	}

	return {
		countDocuments: vi.fn().mockResolvedValue(documents.length),
		find: vi.fn().mockReturnValue(cursor),
		_cursor: cursor,
	}
}

const createDefaultParams = (overrides: Partial<QueryParamsBase> = {}): QueryParamsBase => ({
	all: false,
	limit: 10,
	page: 1,
	search: null,
	sort: [],
	whereType: QueryKeys.and,
	where: [],
	auth: [],
	authType: QueryKeys.and,
	select: undefined,
	...overrides,
})

describe('dbs/mongo/query', () => {
	describe('parseMongodbQueryParams', () => {
		test('should return empty results for empty collection', async () => {
			const collection = createMockCollection([])
			const params = createDefaultParams()

			const result = await parseMongodbQueryParams(collection as any, params)

			expect(result.docs.total).toBe(0)
			expect(result.docs.count).toBe(0)
			expect(result.results).toEqual([])
		})

		test('should return paginated results', async () => {
			const docs = [
				{ _id: '1', name: 'Test 1' },
				{ _id: '2', name: 'Test 2' },
			]
			const collection = createMockCollection(docs)
			const params = createDefaultParams({ limit: 10, page: 1 })

			const result = await parseMongodbQueryParams(collection as any, params)

			expect(result.docs.count).toBe(2)
			expect(result.results).toEqual(docs)
			expect(result.pages.current).toBe(1)
		})

		test('should calculate pages correctly', async () => {
			const collection = createMockCollection([])
			collection.countDocuments.mockResolvedValue(25)

			const params = createDefaultParams({ limit: 10, page: 2 })
			const result = await parseMongodbQueryParams(collection as any, params)

			expect(result.pages.start).toBe(1)
			expect(result.pages.last).toBe(3) // 25/10 = 3 pages
			expect(result.pages.current).toBe(2)
			expect(result.pages.previous).toBe(1)
			expect(result.pages.next).toBe(3)
		})

		test('should return null for previous on first page', async () => {
			const collection = createMockCollection([])
			collection.countDocuments.mockResolvedValue(25)

			const params = createDefaultParams({ limit: 10, page: 1 })
			const result = await parseMongodbQueryParams(collection as any, params)

			expect(result.pages.previous).toBeNull()
			expect(result.pages.next).toBe(2)
		})

		test('should return null for next on last page', async () => {
			const collection = createMockCollection([])
			collection.countDocuments.mockResolvedValue(25)

			const params = createDefaultParams({ limit: 10, page: 3 })
			const result = await parseMongodbQueryParams(collection as any, params)

			expect(result.pages.next).toBeNull()
			expect(result.pages.previous).toBe(2)
		})

		test('should apply sort', async () => {
			const collection = createMockCollection([])
			const params = createDefaultParams({
				sort: [
					{ field: 'createdAt', desc: true },
					{ field: 'name', desc: false },
				],
			})

			await parseMongodbQueryParams(collection as any, params)

			expect(collection._cursor.sort).toHaveBeenCalledWith({
				createdAt: 'desc',
				name: 'asc',
			})
		})

		test('should apply limit and skip for pagination', async () => {
			const collection = createMockCollection([])
			const params = createDefaultParams({ limit: 10, page: 3 })

			await parseMongodbQueryParams(collection as any, params)

			expect(collection._cursor.limit).toHaveBeenCalledWith(10)
			expect(collection._cursor.skip).toHaveBeenCalledWith(20) // (3-1) * 10
		})

		test('should not apply limit/skip when all is true', async () => {
			const collection = createMockCollection([])
			const params = createDefaultParams({ all: true, limit: 10, page: 2 })

			await parseMongodbQueryParams(collection as any, params)

			expect(collection._cursor.limit).not.toHaveBeenCalled()
			expect(collection._cursor.skip).not.toHaveBeenCalled()
		})

		test('should build search query with regex', async () => {
			const collection = createMockCollection([])
			const params = createDefaultParams({
				search: { value: 'test', fields: ['name', 'email'] },
			})

			await parseMongodbQueryParams(collection as any, params)

			const findCall = collection.find.mock.calls[0][0]
			expect(findCall).toHaveProperty('$and')

			const searchQuery = findCall.$and.find((q: any) => q.$or)
			expect(searchQuery.$or).toHaveLength(2)
			expect(searchQuery.$or[0].name.$regex).toBeInstanceOf(RegExp)
			expect(searchQuery.$or[1].email.$regex).toBeInstanceOf(RegExp)
		})

		test('should build where query with eq condition', async () => {
			const collection = createMockCollection([])
			const params = createDefaultParams({
				where: [{ field: 'status', value: 'active', condition: Conditions.eq }],
			})

			await parseMongodbQueryParams(collection as any, params)

			const findCall = collection.find.mock.calls[0][0]
			expect(findCall.$and).toContainEqual({
				$and: [{ status: { $eq: 'active' } }],
			})
		})

		test('should convert id field to _id', async () => {
			const collection = createMockCollection([])
			const params = createDefaultParams({
				where: [{ field: 'id', value: '123', condition: Conditions.eq }],
			})

			await parseMongodbQueryParams(collection as any, params)

			const findCall = collection.find.mock.calls[0][0]
			expect(findCall.$and).toContainEqual({
				$and: [{ _id: { $eq: '123' } }],
			})
		})

		test('should build where query with different conditions', async () => {
			const collection = createMockCollection([])
			const conditions = [
				{ condition: Conditions.lt, expected: '$lt' },
				{ condition: Conditions.lte, expected: '$lte' },
				{ condition: Conditions.gt, expected: '$gt' },
				{ condition: Conditions.gte, expected: '$gte' },
				{ condition: Conditions.ne, expected: '$ne' },
				{ condition: Conditions.in, expected: '$in' },
				{ condition: Conditions.nin, expected: '$nin' },
			]

			for (const { condition, expected } of conditions) {
				collection.find.mockClear()

				const params = createDefaultParams({
					where: [{ field: 'count', value: 10, condition }],
				})

				await parseMongodbQueryParams(collection as any, params)

				const findCall = collection.find.mock.calls[0][0]
				const whereQuery = findCall.$and[0].$and[0]
				expect(whereQuery.count).toHaveProperty(expected)
			}
		})

		test('should build nested or/and where blocks', async () => {
			const collection = createMockCollection([])
			const params = createDefaultParams({
				where: [
					{
						condition: QueryKeys.or,
						value: [
							{ field: 'status', value: 'active', condition: Conditions.eq },
							{ field: 'status', value: 'pending', condition: Conditions.eq },
						],
					},
				],
			})

			await parseMongodbQueryParams(collection as any, params)

			const findCall = collection.find.mock.calls[0][0]
			expect(findCall.$and).toContainEqual({
				$and: [
					{
						$or: [{ status: { $eq: 'active' } }, { status: { $eq: 'pending' } }],
					},
				],
			})
		})

		test('should combine where and auth clauses', async () => {
			const collection = createMockCollection([])
			const params = createDefaultParams({
				where: [{ field: 'status', value: 'active', condition: Conditions.eq }],
				auth: [{ field: 'userId', value: 'user123', condition: Conditions.eq }],
			})

			await parseMongodbQueryParams(collection as any, params)

			const findCall = collection.find.mock.calls[0][0]
			expect(findCall.$and).toHaveLength(2)
		})

		test('should apply projection from select', async () => {
			const collection = createMockCollection([])
			const params = createDefaultParams({
				select: ['name', 'email', 'createdAt'],
			})

			await parseMongodbQueryParams(collection as any, params)

			const findOptions = collection.find.mock.calls[0][1]
			expect(findOptions.projection).toEqual({
				name: 1,
				email: 1,
				createdAt: 1,
			})
		})

		test('should not apply projection when select is empty', async () => {
			const collection = createMockCollection([])
			const params = createDefaultParams({
				select: [],
			})

			await parseMongodbQueryParams(collection as any, params)

			const findOptions = collection.find.mock.calls[0][1]
			expect(findOptions.projection).toBeUndefined()
		})

		test('should handle whereType or', async () => {
			const collection = createMockCollection([])
			const params = createDefaultParams({
				whereType: QueryKeys.or,
				where: [
					{ field: 'status', value: 'active', condition: Conditions.eq },
					{ field: 'type', value: 'premium', condition: Conditions.eq },
				],
			})

			await parseMongodbQueryParams(collection as any, params)

			const findCall = collection.find.mock.calls[0][0]
			expect(findCall.$and).toContainEqual({
				$or: [{ status: { $eq: 'active' } }, { type: { $eq: 'premium' } }],
			})
		})

		test('should handle empty search fields', async () => {
			const collection = createMockCollection([])
			const params = createDefaultParams({
				search: { value: 'test', fields: [] },
			})

			await parseMongodbQueryParams(collection as any, params)

			const findCall = collection.find.mock.calls[0][0]
			// Should not add search query when fields are empty
			expect(findCall).toEqual({})
		})

		test('should handle last page with exact division', async () => {
			const collection = createMockCollection([])
			collection.countDocuments.mockResolvedValue(30)

			const params = createDefaultParams({ limit: 10, page: 1 })
			const result = await parseMongodbQueryParams(collection as any, params)

			expect(result.pages.last).toBe(3)
		})

		test('should handle single result page', async () => {
			const collection = createMockCollection([])
			collection.countDocuments.mockResolvedValue(5)

			const params = createDefaultParams({ limit: 10, page: 1 })
			const result = await parseMongodbQueryParams(collection as any, params)

			expect(result.pages.start).toBe(1)
			expect(result.pages.last).toBe(1)
			expect(result.pages.next).toBeNull()
			expect(result.pages.previous).toBeNull()
		})

		test('should handle zero total documents', async () => {
			const collection = createMockCollection([])
			collection.countDocuments.mockResolvedValue(0)

			const params = createDefaultParams({ limit: 10, page: 1 })
			const result = await parseMongodbQueryParams(collection as any, params)

			expect(result.pages.last).toBe(1) // Minimum 1 page
			expect(result.docs.total).toBe(0)
		})
	})
})
