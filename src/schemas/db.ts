import { Paths, Pipe, PipeOutput, v } from 'valleyed'

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

const queryWhere = <T>() =>
	v.object({
		field: v.string() as Pipe<Paths<T, string>>,
		value: v.any(),
		condition: v.defaultsOnFail(v.defaults(v.in(Object.values(Conditions)), Conditions.eq), Conditions.eq),
	})

const queryWhereBlock = <T>() =>
	v.object({
		condition: queryKeys,
		value: v.array(queryWhere<T>()),
	})

const queryWhereClause = <T>() => v.defaults(v.array(v.or([queryWhere<T>(), queryWhereBlock<T>()])), [])

export function queryParamsPipe<T>() {
	const pagLimit = Instance.get().settings.requests.paginationDefaultLimit
	return v.object({
		all: v.defaults(v.boolean(), false),
		limit: v.defaultsOnFail(v.defaults(v.number().pipe(v.lte(pagLimit)), pagLimit), pagLimit),
		page: v.defaultsOnFail(v.defaults(v.number().pipe(v.gte(1)), 1), 1),
		search: v.optional(
			v.object({
				value: v.string(),
				fields: v.array(v.string() as Pipe<Paths<T, string>>),
			}),
		),
		sort: v.defaults(
			v.array(
				v.object({
					field: v.string() as Pipe<Paths<T, string>>,
					desc: v.defaults(v.boolean(), false),
				}),
			),
			[],
		),
		whereType: queryKeys,
		authType: queryKeys,
		where: queryWhereClause<T>(),
		auth: v.any<never>().pipe(() => [] as QueryWhereClause<T>),
	})
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

export type QueryWhere<T = unknown> = PipeOutput<ReturnType<typeof queryWhere<T>>>
export type QueryWhereBlock<T = unknown> = PipeOutput<ReturnType<typeof queryWhereBlock<T>>>
export type QueryWhereClause<T> = NonNullable<PipeOutput<ReturnType<typeof queryWhereClause<T>>>>
export type QueryParams<T = unknown> = PipeOutput<ReturnType<typeof queryParamsPipe<T>>>
export type QueryResults<T> = PipeOutput<ReturnType<typeof queryResultsPipe<T>>>
