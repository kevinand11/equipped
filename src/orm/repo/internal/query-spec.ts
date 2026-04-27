import type { WhereFactory } from './state'
import { QueryGroup, type OrderBy, type QueryOptions, type QuerySpec } from '../../query'

export function toQuerySpec(factories: readonly WhereFactory[]): QuerySpec {
	const root = QueryGroup.from()
	for (const factory of factories) {
		const group = factory(QueryGroup.from())
		root.children.push(...group.children)
	}
	return { clauses: root.children }
}

export function queryOptionsForRead(
	select: readonly string[] | undefined,
	orderBy: readonly OrderBy[],
	limit?: number,
	offset?: number,
): QueryOptions {
	return {
		select,
		orderBy: [...orderBy],
		limit,
		offset,
	}
}
