import type { AnyPreloadDef } from '../../../relations'
import type { AnySchema } from '../../../schema'
import type { SchemaInsertInput, SchemaUpdateInput } from '../../../schema-validations'
import type { SchemaContext } from '../../builders'
import type { SelectedWithPreloads } from '../../types'
import { toQuerySpec } from '../query-spec'
import type { WhereFactory } from '../state'
import { validateInsertInput, validateUpdateInput } from '../validation-gateway'

type UpsertInput<S extends AnySchema> = { insert: SchemaInsertInput<S> } | { insert: SchemaInsertInput<S>; update: SchemaUpdateInput<S> }

export async function runOneInsert<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]>(
	context: SchemaContext<S>,
	state: { select: readonly Sel[] | undefined; preloads: P },
	data: SchemaInsertInput<S>,
): Promise<SelectedWithPreloads<S, Sel, P>> {
	const validated = validateInsertInput(context.schema, data)
	const row = await context.use.insertOne(validated as any)
	const [resolved] = await context.shapeRows(state.select, state.preloads, [row])
	return resolved
}

export async function runAllInsert<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]>(
	context: SchemaContext<S>,
	state: { select: readonly Sel[] | undefined; preloads: P },
	data: SchemaInsertInput<S>[],
): Promise<SelectedWithPreloads<S, Sel, P>[]> {
	const validated = data.map((entry) => validateInsertInput(context.schema, entry))
	const rows = await context.use.insertMany(validated as any)
	return context.shapeRows(state.select, state.preloads, rows)
}

export async function runOneUpdate<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]>(
	context: SchemaContext<S>,
	state: { whereFactories: readonly WhereFactory[]; select: readonly Sel[] | undefined; preloads: P },
	data: SchemaUpdateInput<S>,
): Promise<SelectedWithPreloads<S, Sel, P> | null> {
	const validated = validateUpdateInput(context.schema, data)
	const row = await context.use.updateOne(toQuerySpec(state.whereFactories), validated)
	return context.shapeOneRow(state.select, state.preloads, row)
}

export async function runAllUpdate<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]>(
	context: SchemaContext<S>,
	state: { whereFactories: readonly WhereFactory[]; select: readonly Sel[] | undefined; preloads: P },
	data: SchemaUpdateInput<S>,
): Promise<SelectedWithPreloads<S, Sel, P>[]> {
	const validated = validateUpdateInput(context.schema, data)
	const rows = await context.use.updateMany(toQuerySpec(state.whereFactories), validated)
	return context.shapeRows(state.select, state.preloads, rows)
}

export async function runOneUpsert<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]>(
	context: SchemaContext<S>,
	state: { whereFactories: readonly WhereFactory[]; select: readonly Sel[] | undefined; preloads: P },
	data: UpsertInput<S>,
): Promise<SelectedWithPreloads<S, Sel, P>> {
	const insert = validateInsertInput(context.schema, data.insert)
	const update = 'update' in data ? validateUpdateInput(context.schema, data.update) : undefined
	const row = await context.use.upsertOne(toQuerySpec(state.whereFactories), update ? ({ insert, update } as any) : { insert })
	return (await context.shapeOneRow(state.select, state.preloads, row)) as SelectedWithPreloads<S, Sel, P>
}

export async function runOneDelete<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]>(
	context: SchemaContext<S>,
	state: { whereFactories: readonly WhereFactory[]; select: readonly Sel[] | undefined; preloads: P },
): Promise<SelectedWithPreloads<S, Sel, P> | null> {
	const row = await context.use.deleteOne(toQuerySpec(state.whereFactories))
	return context.shapeOneRow(state.select, state.preloads, row)
}

export async function runAllDelete<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]>(
	context: SchemaContext<S>,
	state: { whereFactories: readonly WhereFactory[]; select: readonly Sel[] | undefined; preloads: P },
): Promise<SelectedWithPreloads<S, Sel, P>[]> {
	const rows = await context.use.deleteMany(toQuerySpec(state.whereFactories))
	return context.shapeRows(state.select, state.preloads, rows)
}
