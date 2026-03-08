import {
	Condition,
	type AndOp,
	type LimitOp,
	type OffsetOp,
	type OrderByOp,
	type OrOp,
	type QueryAST,
	type QueryOp,
	type RawOp,
	type SelectOp,
	type WhereOp,
} from './types'

export * from './types'

export const eq = <T>(value: T): { condition: Condition.eq; value: T } => ({ condition: Condition.eq, value })
export const ne = <T>(value: T): { condition: Condition.ne; value: T } => ({ condition: Condition.ne, value })
export const gt = <T>(value: T): { condition: Condition.gt; value: T } => ({ condition: Condition.gt, value })
export const gte = <T>(value: T): { condition: Condition.gte; value: T } => ({ condition: Condition.gte, value })
export const lt = <T>(value: T): { condition: Condition.lt; value: T } => ({ condition: Condition.lt, value })
export const lte = <T>(value: T): { condition: Condition.lte; value: T } => ({ condition: Condition.lte, value })
export const isIn = <T>(value: T[]): { condition: Condition.in; value: T[] } => ({ condition: Condition.in, value })
export const notIn = <T>(value: T[]): { condition: Condition.nin; value: T[] } => ({ condition: Condition.nin, value })
export const like = (value: string): { condition: Condition.like; value: string } => ({ condition: Condition.like, value })
export const exists = (): { condition: Condition.exists; value: true } => ({ condition: Condition.exists, value: true })
export const notExists = (): { condition: Condition.exists; value: false } => ({ condition: Condition.exists, value: false })
export const contains = <T>(value: T[]): { condition: Condition.contains; value: T[] } => ({ condition: Condition.contains, value })
export const notContains = <T>(value: T[]): { condition: Condition.notContains; value: T[] } => ({
	condition: Condition.notContains,
	value,
})

export function where(field: string, op: { condition: Condition; value: unknown }): WhereOp {
	return { kind: 'where', field, condition: op.condition, value: op.value }
}

export function and(...clauses: QueryOp[]): AndOp {
	return { kind: 'and', clauses }
}

export function or(...clauses: QueryOp[]): OrOp {
	return { kind: 'or', clauses }
}

export function orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): OrderByOp {
	return { kind: 'orderBy', field, direction }
}

export function limit(value: number): LimitOp {
	return { kind: 'limit', value }
}

export function offset(value: number): OffsetOp {
	return { kind: 'offset', value }
}

export function select(...fields: string[]): SelectOp {
	return { kind: 'select', fields }
}

export function raw(value: unknown): RawOp {
	return { kind: 'raw', value }
}

export function query(...ops: QueryOp[]): QueryAST {
	const ast: QueryAST = {
		wheres: [],
		ands: [],
		ors: [],
		orderBys: [],
		limit: null,
		offset: null,
		selects: [],
		raws: [],
	}

	for (const op of ops) {
		switch (op.kind) {
			case 'where':
				ast.wheres.push(op)
				break
			case 'and':
				ast.ands.push(op)
				break
			case 'or':
				ast.ors.push(op)
				break
			case 'orderBy':
				ast.orderBys.push(op)
				break
			case 'limit':
				ast.limit = op.value
				break
			case 'offset':
				ast.offset = op.value
				break
			case 'select':
				ast.selects.push(...op.fields)
				break
			case 'raw':
				ast.raws.push(op.value)
				break
		}
	}

	return ast
}
