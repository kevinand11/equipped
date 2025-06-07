import { Collection } from 'mongodb'
import { v } from 'valleyed'

import {
	QueryKeys,
	queryResultsPipe,
	type QueryParams,
	type QueryResults,
	type QueryWhereBlock,
	type QueryWhereClause,
} from '../../schemas/db'
import * as core from '../base/core'

export const parseMongodbQueryParams = async <Model extends core.Model<{ _id: string }>>(
	collection: Collection<Model>,
	params: QueryParams,
): Promise<QueryResults<Model>> => {
	// Handle where/search clauses
	const query = <ReturnType<typeof buildWhereQuery>[]>[]
	const where = buildWhereQuery(params.where ?? [], params.whereType)
	if (where) query.push(where)
	const auth = buildWhereQuery(params.auth ?? [], params.authType)
	if (auth) query.push(auth)
	if (params.search && params.search.fields.length > 0) {
		const search = params.search.fields.map((field) => ({
			[field]: {
				$regex: new RegExp(params.search!.value, 'i'),
			},
		}))
		query.push({ $or: search })
	}
	const totalClause = {}
	if (query.length > 0) totalClause['$and'] = query

	// Handle sort clauses
	const sort = params.sort?.map((p) => [p.field, p.desc ? 'desc' : 'asc']) ?? []

	// Handle limit/offest clause
	const all = params.all ?? false
	const limit = params.limit
	const page = params.page

	const total = await collection.countDocuments(totalClause)

	let builtQuery = collection.find(totalClause)
	if (sort.length) builtQuery = builtQuery.sort(Object.fromEntries(sort))
	if (!all && limit) {
		builtQuery = builtQuery.limit(limit)
		if (page) builtQuery = builtQuery.skip((page - 1) * limit)
	}

	const results = await builtQuery.toArray()
	const start = 1
	const last = Math.ceil(total / limit) || 1
	const next = page >= last ? null : page + 1
	const previous = page <= start ? null : page - 1

	return queryResultsPipe(v.any()).parse({
		pages: { start, last, next, previous, current: page },
		docs: { limit, total, count: results.length },
		results: results as any[],
	} satisfies QueryResults<Model>)
}

function isWhereBlock<T>(param: QueryWhereClause<T>[number]): param is QueryWhereBlock<T> {
	return Object.values(QueryKeys).includes(param.condition as QueryKeys)
}

const buildWhereQuery = (params: QueryWhereClause<unknown>, key: QueryKeys = QueryKeys.and): Record<string, Record<string, any>> | null => {
	const where = (Array.isArray(params) ? params : [])
		.map((param) => {
			if (isWhereBlock<unknown>(param)) return buildWhereQuery(param.value, param.condition)
			const { field } = param
			const checkedField = field === 'id' ? '_id' : (field ?? '')
			const checkedValue = param.value === undefined ? '' : param.value
			return {
				field: checkedField,
				value: checkedValue,
				condition: param.condition,
				isWhere: true,
			}
		})
		.filter((c) => !!c)
		.map((c) => {
			if (c.isWhere) return { [`${c.field}`]: { [`$${c.condition}`]: c.value } }
			else return c
		})

	return where.length > 0 ? { [`$${key}`]: where } : null
}
