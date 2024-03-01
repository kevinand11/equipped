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

export type QueryWhere = { field: string, value: any, condition?: Conditions }
export type QueryWhereBlock = { condition: QueryKeys, value: (QueryWhere | QueryWhereBlock)[] }
export type QueryWhereClause = QueryWhere | QueryWhereBlock

export type QueryParams = {
    where?: QueryWhereClause[]
    auth?: QueryWhereClause[]
    whereType?: QueryKeys
    authType?: QueryKeys
    sort?: { field: string, desc?: boolean }[]
    limit?: number
    all?: boolean
    page?: number
    search?: { value: string, fields: string[] }
}