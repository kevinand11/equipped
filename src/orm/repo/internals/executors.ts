import { planSelection } from './computeds'
import type { SelectedWithPreloads } from './types'
import { assertNormalisedAggregate, assertNormalisedFilter, type FilterGroup } from '../../filter'
import type { AggregateSpec } from '../../orm-adapter'
import type { OrderBy } from '../../query-options'
import type { AnyPreloadDef } from '../../relations'
import type { AnySchema } from '../../schema'
import { validateCreate, validateCreateMany, validateUpdate, validateUpsertConflicts, type SchemaCreateInput, type SchemaUpdateInput } from '../../schema-validations'
import { SetOp, isUpdateOp, type AnyUpdateOp } from '../../updates'
import type { SchemaContext, UpsertInput } from '../builders'

export async function runOneRead<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]>(
	context: SchemaContext<S>,
	state: {
		where: FilterGroup
		select: readonly Sel[] | undefined
		preloads: P
	},
): Promise<SelectedWithPreloads<S, Sel, P> | null> {
	assertNormalisedFilter(context.schema, state.where)
	const row = await context.use.findOne(state.where)
	if (!row) return null
	return context.shapeOneRow(state.select, state.preloads, row)
}

export async function runAllRead<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]>(
	context: SchemaContext<S>,
	state: {
		where: FilterGroup
		select: readonly Sel[] | undefined
		preloads: P
		orderBy: readonly OrderBy[]
		limit?: number
		offset?: number
	},
): Promise<SelectedWithPreloads<S, Sel, P>[]> {
	assertNormalisedFilter(context.schema, state.where)
	const plan = planSelection(context.schema, state.select as readonly string[] | undefined)
	const rows = await context.use.findMany(state.where, {
		select: plan.adapterSelect,
		orderBy: [...state.orderBy],
		limit: state.limit,
		offset: state.offset,
	})
	return context.shapeRows(state.select, state.preloads, rows)
}

export async function runOneCreate<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]>(
	context: SchemaContext<S>,
	state: { select: readonly Sel[] | undefined; preloads: P },
	data: SchemaCreateInput<S>,
): Promise<SelectedWithPreloads<S, Sel, P>> {
	const validated = validateCreate(context.schema, data as any)
	const row = await context.use.createOne(validated as any)
	const [resolved] = await context.shapeRows(state.select, state.preloads, [row])
	return resolved
}

export async function runAllCreate<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]>(
	context: SchemaContext<S>,
	state: { select: readonly Sel[] | undefined; preloads: P },
	data: SchemaCreateInput<S>[],
): Promise<SelectedWithPreloads<S, Sel, P>[]> {
	const validated = validateCreateMany(context.schema, data as any)
	const rows = await context.use.createMany(validated as any)
	return context.shapeRows(state.select, state.preloads, rows)
}

export async function runOneUpdate<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]>(
	context: SchemaContext<S>,
	state: { where: FilterGroup; select: readonly Sel[] | undefined; preloads: P },
	data: SchemaUpdateInput<S>,
): Promise<SelectedWithPreloads<S, Sel, P> | null> {
	assertNormalisedFilter(context.schema, state.where)
	const validated = validateUpdate(context.schema, data as any)
	const row = await context.use.updateOne(state.where, validated as any)
	return context.shapeOneRow(state.select, state.preloads, row)
}

export async function runAllUpdate<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]>(
	context: SchemaContext<S>,
	state: { where: FilterGroup; select: readonly Sel[] | undefined; preloads: P },
	data: SchemaUpdateInput<S>,
): Promise<SelectedWithPreloads<S, Sel, P>[]> {
	assertNormalisedFilter(context.schema, state.where)
	const validated = validateUpdate(context.schema, data as any)
	const rows = await context.use.updateMany(state.where, validated as any)
	return context.shapeRows(state.select, state.preloads, rows)
}

export async function runOneUpsert<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]>(
	context: SchemaContext<S>,
	state: { where: FilterGroup; select: readonly Sel[] | undefined; preloads: P },
	data: UpsertInput<S>,
): Promise<SelectedWithPreloads<S, Sel, P>> {
	assertNormalisedFilter(context.schema, state.where)
	const create = validateCreate(context.schema, data.create as any)
	const ops: AnyUpdateOp[] = []
	if ('update' in data) {
		const validated = validateUpdate(context.schema, data.update as any)
		const plainValues: Record<string, unknown> = {}
		for (const [key, value] of Object.entries(validated)) {
			if (isUpdateOp(value)) {
				ops.push(value)
			} else {
				plainValues[key] = value
			}
		}
		if (Object.keys(plainValues).length > 0) {
			ops.unshift(new SetOp(plainValues))
		}
	}
	if (ops.length > 0) {
		validateUpsertConflicts(context.schema, data.create as Record<string, unknown>, ops)
	}
	const row = await context.use.upsertOne(state.where, create as any, ops)
	return (await context.shapeOneRow(state.select, state.preloads, row)) as SelectedWithPreloads<S, Sel, P>
}

export async function runOneDelete<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]>(
	context: SchemaContext<S>,
	state: { where: FilterGroup; select: readonly Sel[] | undefined; preloads: P },
): Promise<SelectedWithPreloads<S, Sel, P> | null> {
	assertNormalisedFilter(context.schema, state.where)
	const row = await context.use.deleteOne(state.where)
	return context.shapeOneRow(state.select, state.preloads, row)
}

export async function runAllDelete<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]>(
	context: SchemaContext<S>,
	state: { where: FilterGroup; select: readonly Sel[] | undefined; preloads: P },
): Promise<SelectedWithPreloads<S, Sel, P>[]> {
	assertNormalisedFilter(context.schema, state.where)
	const rows = await context.use.deleteMany(state.where)
	return context.shapeRows(state.select, state.preloads, rows)
}

export async function runAggregate<S extends AnySchema>(
	context: SchemaContext<S>,
	spec: AggregateSpec,
): Promise<Array<Record<string, unknown>>> {
	assertNormalisedAggregate(context.schema, context.use, spec)
	return context.use.aggregate(spec)
}
