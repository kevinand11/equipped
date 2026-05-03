import { planSelection } from './computeds'
import type { SelectedWithPreloads } from './types'
import type { OrderBy, QueryGroup } from '../../query'
import type { AnyPreloadDef } from '../../relations'
import type { AnySchema } from '../../schema'
import { validateInsert, validateUpdate, type SchemaInsertInput, type SchemaUpdateInput } from '../../schema-validations'
import type { SchemaContext } from '../builders'

export async function runOneRead<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]>(
	context: SchemaContext<S>,
	state: {
		where: QueryGroup
		select: readonly Sel[] | undefined
		preloads: P
	},
): Promise<SelectedWithPreloads<S, Sel, P> | null> {
	const row = await context.use.findOne(state.where)
	if (!row) return null
	return context.shapeOneRow(state.select, state.preloads, row)
}

export async function runAllRead<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]>(
	context: SchemaContext<S>,
	state: {
		where: QueryGroup
		select: readonly Sel[] | undefined
		preloads: P
		orderBy: readonly OrderBy[]
		limit?: number
		offset?: number
	},
): Promise<SelectedWithPreloads<S, Sel, P>[]> {
	const plan = planSelection(context.schema, state.select as readonly string[] | undefined)
	const rows = await context.use.findMany(state.where, {
		select: plan.adapterSelect,
		orderBy: [...state.orderBy],
		limit: state.limit,
		offset: state.offset,
	})
	return context.shapeRows(state.select, state.preloads, rows)
}

type UpsertInput<S extends AnySchema> = { insert: SchemaInsertInput<S> } | { insert: SchemaInsertInput<S>; update: SchemaUpdateInput<S> }

export async function runOneInsert<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]>(
	context: SchemaContext<S>,
	state: { select: readonly Sel[] | undefined; preloads: P },
	data: SchemaInsertInput<S>,
): Promise<SelectedWithPreloads<S, Sel, P>> {
	const validated = validateInsert(context.schema, data as any)
	const row = await context.use.insertOne(validated as any)
	const [resolved] = await context.shapeRows(state.select, state.preloads, [row])
	return resolved
}

export async function runAllInsert<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]>(
	context: SchemaContext<S>,
	state: { select: readonly Sel[] | undefined; preloads: P },
	data: SchemaInsertInput<S>[],
): Promise<SelectedWithPreloads<S, Sel, P>[]> {
	const validated = data.map((entry) => validateInsert(context.schema, entry as any))
	const rows = await context.use.insertMany(validated as any)
	return context.shapeRows(state.select, state.preloads, rows)
}

export async function runOneUpdate<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]>(
	context: SchemaContext<S>,
	state: { where: QueryGroup; select: readonly Sel[] | undefined; preloads: P },
	data: SchemaUpdateInput<S>,
): Promise<SelectedWithPreloads<S, Sel, P> | null> {
	const validated = validateUpdate(context.schema, data as any)
	const row = await context.use.updateOne(state.where, validated as any)
	return context.shapeOneRow(state.select, state.preloads, row)
}

export async function runAllUpdate<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]>(
	context: SchemaContext<S>,
	state: { where: QueryGroup; select: readonly Sel[] | undefined; preloads: P },
	data: SchemaUpdateInput<S>,
): Promise<SelectedWithPreloads<S, Sel, P>[]> {
	const validated = validateUpdate(context.schema, data as any)
	const rows = await context.use.updateMany(state.where, validated as any)
	return context.shapeRows(state.select, state.preloads, rows)
}

export async function runOneUpsert<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]>(
	context: SchemaContext<S>,
	state: { where: QueryGroup; select: readonly Sel[] | undefined; preloads: P },
	data: UpsertInput<S>,
): Promise<SelectedWithPreloads<S, Sel, P>> {
	const insert = validateInsert(context.schema, data.insert as any)
	const update = 'update' in data ? validateUpdate(context.schema, data.update as any) : undefined
	const row = await context.use.upsertOne(state.where, update ? ({ insert, update } as any) : { insert })
	return (await context.shapeOneRow(state.select, state.preloads, row)) as SelectedWithPreloads<S, Sel, P>
}

export async function runOneDelete<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]>(
	context: SchemaContext<S>,
	state: { where: QueryGroup; select: readonly Sel[] | undefined; preloads: P },
): Promise<SelectedWithPreloads<S, Sel, P> | null> {
	const row = await context.use.deleteOne(state.where)
	return context.shapeOneRow(state.select, state.preloads, row)
}

export async function runAllDelete<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]>(
	context: SchemaContext<S>,
	state: { where: QueryGroup; select: readonly Sel[] | undefined; preloads: P },
): Promise<SelectedWithPreloads<S, Sel, P>[]> {
	const rows = await context.use.deleteMany(state.where)
	return context.shapeRows(state.select, state.preloads, rows)
}
