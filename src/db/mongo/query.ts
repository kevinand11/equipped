import { Collection } from 'mongodb'

import { Instance } from '../../instance'
import * as core from '../core'
import type { QueryParams, QueryResults, QueryWhere, QueryWhereClause } from '../query'
import { Conditions, QueryKeys } from '../query'

export const parseMongodbQueryParams = async <Model extends core.Model<{ _id: string }>>(
	collection: Collection<Model>,
	params: QueryParams,
): Promise<QueryResults<Model>> => {
	// Handle where clauses
	const query = [] as ReturnType<typeof buildWhereQuery>[]
	const whereType = Object.values(QueryKeys).indexOf(params.whereType!) !== -1 ? params.whereType! : QueryKeys.and
	const authType = Object.values(QueryKeys).indexOf(params.authType!) !== -1 ? params.authType! : QueryKeys.and
	const where = buildWhereQuery(params.where ?? [], whereType)
	if (where) query.push(where)
	const auth = buildWhereQuery(params.auth ?? [], authType)
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

	const all = params.all ?? false

	// Handle limit clause
	const settings = Instance.get().settings
	const limit =
		Number(params.limit) <= settings.requests.paginationDefaultLimit ? Number(params.limit) : settings.requests.paginationDefaultLimit

	// Handle offset clause
	let page = Number.isNaN(Number(params.page)) ? 0 : Number(params.page)
	page = page < 1 ? 1 : page

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

	return {
		pages: { start, last, next, previous, current: page },
		docs: { limit, total, count: results.length },
		results: results as Model[],
	}
}

const buildWhereQuery = (params: QueryWhereClause<unknown>[], key: QueryKeys = QueryKeys.and) => {
	const where = (Array.isArray(params) ? params : [])
		.map((param) => {
			if (Object.values(QueryKeys).includes(param.condition as QueryKeys))
				return buildWhereQuery(param.value as any, param.condition as QueryKeys)
			const { field } = param as QueryWhere<unknown>
			const checkedField = field === 'id' ? '_id' : (field ?? '')
			const checkedValue = param.value === undefined ? '' : param.value
			const checkedCondition = Object.keys(Conditions).indexOf(param.condition as string) > -1 ? param.condition : Conditions.eq
			return {
				field: checkedField,
				value: checkedValue,
				condition: checkedCondition,
				isWhere: true,
			}
		})
		.filter((c) => c)
		.map((c) => {
			if (c.isWhere)
				return {
					[`${c.field}`]: { [`$${c.condition}`]: c.value },
				}
			else return c
		})

	return where.length > 0 ? { [`$${key}`]: where } : null
}
