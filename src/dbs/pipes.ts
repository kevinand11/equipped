import { ConditionalObjectKeys, Pipe, PipeInput, PipeOutput, v } from 'valleyed'

import { Instance } from '../instance'

export enum QueryKeys {
	and = 'and',
	or = 'or',
}

export enum Conditions {
	lt = 'lt',
	lte = 'lte',
	gt = 'gt',
	gte = 'gte',
	eq = 'eq',
	ne = 'ne',
	in = 'in',
	nin = 'nin',
	exists = 'exists',
}

const queryKeys = v.defaultsOnFail(v.defaults(v.in([QueryKeys.and, QueryKeys.or]), QueryKeys.and), QueryKeys.and)

const queryWhere = v.object({
	field: v.string(),
	value: v.any(),
	condition: v.defaultsOnFail(v.defaults(v.in(Object.values(Conditions)), Conditions.eq), Conditions.eq),
})

const queryWhereBlock = v.object({
	condition: queryKeys,
	value: v.array(queryWhere),
})

const queryWhereClause = v.defaults(v.array(v.or([queryWhere, queryWhereBlock])), [])

export function queryParamsPipe() {
	const pagLimit = Instance.get().settings.server?.requests.paginationDefaultLimit ?? 100
	return v
		.object({
			all: v.defaults(v.boolean(), false),
			limit: v.defaultsOnFail(v.defaults(v.number().pipe(v.lte(pagLimit)), pagLimit), pagLimit),
			page: v.defaultsOnFail(v.defaults(v.number().pipe(v.gte(1)), 1), 1),
			search: v.defaults(
				v.nullish(
					v.object({
						value: v.string(),
						fields: v.array(v.string()),
					}),
				),
				null,
			),
			sort: v.defaults(
				v.array(
					v.object({
						field: v.string(),
						desc: v.defaults(v.boolean(), false),
					}),
				),
				[],
			),
			whereType: queryKeys,
			where: queryWhereClause,
		})
		.pipe((p) => ({ ...p, auth: <(typeof p)['where']>[], authType: QueryKeys.and }))
		.meta({ title: 'Query Params', $refId: 'QueryParams' })
}

export function queryResultsPipe<T>(model: Pipe<any, T, any>) {
	return v.object({
		pages: v.object({
			current: v.number(),
			start: v.number(),
			last: v.number(),
			previous: v.nullable(v.number()),
			next: v.nullable(v.number()),
		}),
		docs: v.object({
			limit: v.number(),
			total: v.number(),
			count: v.number(),
		}),
		results: v.array(model),
	})
}

export function wrapQueryParams(params: QueryParamsInput): QueryParams {
	return queryParamsPipe().parse(params)
}

export type QueryParams = PipeOutput<ReturnType<typeof queryParamsPipe>>
export type QueryParamsInput = ConditionalObjectKeys<PipeInput<ReturnType<typeof queryParamsPipe>>>
export type QueryWhereClause = QueryParams['where'][number]
export type QueryWhere = Extract<QueryWhereClause, { field: string }>
export type QueryWhereBlock = Exclude<QueryWhereClause, { field: string }>
export type QueryResults<T> = PipeOutput<ReturnType<typeof queryResultsPipe<T>>>

export const mongoDbConfigPipe = v
	.object({
		uri: v.string(),
	})
	.meta({ title: 'Mongodb Config', $refId: 'MongodbConfig' })

export type MongoDbConfig = PipeOutput<typeof mongoDbConfigPipe>
