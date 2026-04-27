import type { OrderBy } from '../../../query'
import type { AnyPreloadDef } from '../../../relations'
import type { AnySchema } from '../../../schema'
import type { SchemaContext } from '../../builders'
import type { SelectedWithPreloads } from '../../types'
import { queryOptionsForRead, toQuerySpec } from '../query-spec'
import type { WhereFactory } from '../state'

export async function runOneRead<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]>(
	context: SchemaContext<S>,
	state: {
		whereFactories: readonly WhereFactory[]
		select: readonly Sel[] | undefined
		preloads: P
	},
): Promise<SelectedWithPreloads<S, Sel, P> | null> {
	const row = await context.use.findOne(toQuerySpec(state.whereFactories))
	if (!row) return null
	return context.shapeOneRow(state.select, state.preloads, row)
}

export async function runAllRead<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]>(
	context: SchemaContext<S>,
	state: {
		whereFactories: readonly WhereFactory[]
		select: readonly Sel[] | undefined
		preloads: P
		orderBy: readonly OrderBy[]
		limit?: number
		offset?: number
	},
): Promise<SelectedWithPreloads<S, Sel, P>[]> {
	const plan = context.planSelection(state.select as readonly string[] | undefined)
	const options = queryOptionsForRead(plan.adapterSelect, state.orderBy, state.limit, state.offset)
	const rows = await context.use.findMany(toQuerySpec(state.whereFactories), options)
	return context.shapeRows(state.select, state.preloads, rows)
}
