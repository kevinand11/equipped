export enum Condition {
	eq = 'eq',
	ne = 'ne',
	gt = 'gt',
	gte = 'gte',
	lt = 'lt',
	lte = 'lte',
	in = 'in',
	nin = 'nin',
	like = 'like',
	exists = 'exists',
	contains = 'contains',
	notContains = 'notContains',
}

export type WhereOp = {
	kind: 'where'
	field: string
	condition: Condition
	value: unknown
}

export type AndOp = {
	kind: 'and'
	clauses: QueryOp[]
}

export type OrOp = {
	kind: 'or'
	clauses: QueryOp[]
}

export type OrderByOp = {
	kind: 'orderBy'
	field: string
	direction: 'asc' | 'desc'
}

export type LimitOp = {
	kind: 'limit'
	value: number
}

export type OffsetOp = {
	kind: 'offset'
	value: number
}

export type SelectOp = {
	kind: 'select'
	fields: string[]
}

export type RawOp = {
	kind: 'raw'
	value: unknown
}

export type QueryOp = WhereOp | AndOp | OrOp | OrderByOp | LimitOp | OffsetOp | SelectOp | RawOp

export type QueryAST = {
	wheres: WhereOp[]
	ands: AndOp[]
	ors: OrOp[]
	orderBys: OrderByOp[]
	limit: number | null
	offset: number | null
	selects: string[]
	raws: unknown[]
}
