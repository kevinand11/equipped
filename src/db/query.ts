import { Paths } from '../types'

export type QueryResults<Model> = {
    pages: {
        start: number,
        last: number,
        previous: number | null,
        next: number | null,
        current: number,
    },
    docs: {
        limit: number,
        total: number,
        count: number
    },
    results: Model[]
}

export enum QueryKeys { and = 'and', or = 'or' }

export enum Conditions {
    lt = 'lt', lte = 'lte', gt = 'gt', gte = 'gte',
    eq = 'eq', ne = 'ne', in = 'in', nin = 'nin', exists = 'exists'
}

export type QueryWhere<T> = { field: Paths<T, string>, value: any, condition?: Conditions }
export type QueryWhereBlock<T> = { condition: QueryKeys, value: QueryWhere<T>[] }
export type QueryWhereClause<T> = QueryWhere<T> | QueryWhereBlock<T>

export type QueryParams<T = unknown> = {
    where?: QueryWhereClause<T>[]
    auth?: QueryWhereClause<T>[]
    whereType?: QueryKeys
    authType?: QueryKeys
    sort?: { field: Paths<T, string>, desc?: boolean }[]
    limit?: number
    all?: boolean
    page?: number
    search?: { value: string, fields: Paths<T, string>[] }
}