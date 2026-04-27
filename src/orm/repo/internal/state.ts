import type { AnyField } from '../../fields'
import { OrderBy, QueryGroup } from '../../query'

export type WhereFactory = (query: QueryGroup) => QueryGroup

export function appendWhere(whereFactories: readonly WhereFactory[], factory: WhereFactory): WhereFactory[] {
	return [...whereFactories, factory]
}

export function appendOrderBy(orderBy: readonly OrderBy[], field: string | AnyField, direction: 'asc' | 'desc' = 'asc'): OrderBy[] {
	return [...orderBy, new OrderBy(field, direction)]
}

export function setLimit(limit: number): number {
	return limit
}

export function setOffset(offset: number): number {
	return offset
}
