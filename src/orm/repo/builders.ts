import { v, type Pipe } from 'valleyed'

import { EquippedError } from '../../errors'
import type { OrmUse } from '../adapters/base'
import type { AnyField } from '../fields'
import { OrderBy, QueryGroup, type QueryOptions, type QuerySpec } from '../query'
import type { AnyPreloadDef } from '../relations'
import type { AnySchema, SchemaOutput } from '../schema'
import { validateInsert, validateUpdate, type SchemaInsertInput, type SchemaUpdateInput } from '../schema-validations'
import { resolvePreloads } from './preloads'
import type { SelectedWithPreloads } from './types'

export type ComputedSelectionPlan = {
	requestedSelect: Set<string> | null
	adapterSelect?: string[]
	computeNames: string[]
}

type SchemaPrimaryKeyValue<S extends AnySchema> = SchemaOutput<S>[S['pkField']['name'] & keyof SchemaOutput<S>]
type WhereFactory = (query: QueryGroup) => QueryGroup

type UpsertInput<S extends AnySchema> = { insert: SchemaInsertInput<S> } | { insert: SchemaInsertInput<S>; update: SchemaUpdateInput<S> }
type ReadState<Sel extends string, P extends readonly AnyPreloadDef[] = readonly AnyPreloadDef[]> = {
	whereFactories?: WhereFactory[]
	select?: readonly Sel[]
	preloads?: P
}
type WriteState<Sel extends string, P extends readonly AnyPreloadDef[] = readonly AnyPreloadDef[]> = {
	select?: readonly Sel[]
	preloads?: P
}

type ReadBuilderFor<TBuilder, S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]> = TBuilder extends {
	_builderKind: 'one-read'
}
	? OneBuilder<S, Sel, P>
	: TBuilder extends { _builderKind: 'all-read' }
		? AllBuilder<S, Sel, P>
		: never

type WriteBuilderFor<TBuilder, S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]> = TBuilder extends {
	_builderKind: 'one-insert'
}
	? OneInsertBuilder<S, Sel, P>
	: TBuilder extends { _builderKind: 'all-insert' }
		? AllInsertBuilder<S, Sel, P>
		: TBuilder extends { _builderKind: 'one-update' }
			? OneUpdateBuilder<S, Sel, P>
			: TBuilder extends { _builderKind: 'all-update' }
				? AllUpdateBuilder<S, Sel, P>
				: TBuilder extends { _builderKind: 'one-upsert' }
					? OneUpsertBuilder<S, Sel, P>
					: TBuilder extends { _builderKind: 'one-delete' }
						? OneDeleteBuilder<S, Sel, P>
						: TBuilder extends { _builderKind: 'all-delete' }
							? AllDeleteBuilder<S, Sel, P>
							: never

export class SchemaContext<S extends AnySchema> {
	constructor(
		readonly schema: S,
		private readonly getUse: (target: AnySchema) => OrmUse,
	) {}

	planSelection(select?: readonly string[]) {
		const computedDefs = this.schema.computedDefs as Record<string, { deps: readonly string[] }>
		const computedNames = new Set(Object.keys(computedDefs))
		const persistedNames = new Set(Object.keys(this.schema.fields))

		if (!select || select.length === 0) {
			return {
				requestedSelect: null,
				adapterSelect: undefined,
				computeNames: [...computedNames],
			}
		}

		const requestedSelect = new Set(select)
		const adapterSelect = new Set<string>()
		const computeNames = new Set<string>()

		for (const key of select) {
			if (persistedNames.has(key)) {
				adapterSelect.add(key)
				continue
			}
			if (computedNames.has(key)) {
				computeNames.add(key)
				for (const dep of computedDefs[key].deps) adapterSelect.add(dep)
				continue
			}
			throw new EquippedError('Unknown selected field', {
				schema: this.schema.name,
				selectedField: key,
				availableFields: [...persistedNames, ...computedNames],
			})
		}

		return {
			requestedSelect,
			adapterSelect: [...adapterSelect],
			computeNames: [...computeNames],
		}
	}

	#applySelection(rows: Record<string, unknown>[], plan: ComputedSelectionPlan) {
		const computedDefs = this.schema.computedDefs as Record<
			string,
			{ pipe: Pipe<any, any>; deps: readonly string[]; compute: (data: Record<string, unknown>) => unknown }
		>

		return rows.map((row) => {
			const enriched: Record<string, unknown> = { ...row }
			for (const computeName of plan.computeNames) {
				const def = computedDefs[computeName]
				const depInput: Record<string, unknown> = {}
				for (const dep of def.deps) {
					if (!(dep in row)) {
						throw new EquippedError('Computed field dependency missing from adapter result', {
							schema: this.schema.name,
							computedField: computeName,
							dependency: dep,
							dependencies: def.deps,
						})
					}
					depInput[dep] = row[dep]
				}
				enriched[computeName] = v.assert(def.pipe, def.compute(depInput))
			}

			if (!plan.requestedSelect) return enriched

			const shaped: Record<string, unknown> = {}
			for (const key of plan.requestedSelect) {
				if (key in enriched) shaped[key] = enriched[key]
			}
			return shaped
		})
	}

	#resolvePreloads(rows: Record<string, unknown>[], preloads: readonly AnyPreloadDef[]) {
		return resolvePreloads(rows, preloads, this.getUse)
	}

	async shapeRows<Sel extends string, P extends readonly AnyPreloadDef[]>(
		select: readonly Sel[] | undefined,
		preloads: P,
		rows: Record<string, unknown>[],
	): Promise<SelectedWithPreloads<S, Sel, P>[]> {
		const plan = this.planSelection(select as readonly string[] | undefined)
		const selected = this.#applySelection(rows, plan)
		if (preloads.length === 0) return selected as SelectedWithPreloads<S, Sel, P>[]
		return (await this.#resolvePreloads(selected, preloads)) as SelectedWithPreloads<S, Sel, P>[]
	}

	async shapeOneRow<Sel extends string, P extends readonly AnyPreloadDef[]>(
		select: readonly Sel[] | undefined,
		preloads: P,
		row: Record<string, unknown> | null,
	): Promise<SelectedWithPreloads<S, Sel, P> | null> {
		if (!row) return null
		const [resolved] = await this.shapeRows(select, preloads, [row])
		return resolved ?? null
	}

	get use() {
		return this.getUse(this.schema)
	}
}

function toQuerySpec(factories: readonly WhereFactory[]): QuerySpec {
	const root = QueryGroup.from()
	for (const factory of factories) {
		const group = factory(QueryGroup.from())
		root.children.push(...group.children)
	}
	return { clauses: root.children }
}

function queryOptionsForRead(
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

function withIdFilter<S extends AnySchema>(
	context: SchemaContext<S>,
	where: readonly WhereFactory[],
	id: SchemaPrimaryKeyValue<S>,
): WhereFactory[] {
	return [...where, (q) => q.eq(context.schema.pkField, id)]
}

abstract class ReadSelectState<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]> {
	protected readonly _context: SchemaContext<S>
	protected _whereFactories: WhereFactory[]
	protected _select: readonly Sel[] | undefined
	_preloads: P

	constructor(context: SchemaContext<S>, state?: ReadState<Sel, P>) {
		this._context = context
		this._whereFactories = state?.whereFactories ?? []
		this._select = state?.select
		this._preloads = state?.preloads ?? ([] as unknown as P)
	}

	where(factory: WhereFactory): this {
		this._whereFactories.push(factory)
		return this
	}

	select<NewSel extends keyof SchemaOutput<S> & string>(fields: readonly NewSel[]): ReadBuilderFor<this, S, NewSel, P> {
		return this._clone<NewSel, P>({ select: fields })
	}

	preload<NewP extends readonly AnyPreloadDef[]>(defs: NewP): ReadBuilderFor<this, S, Sel, NewP> {
		return this._clone<Sel, NewP>({ preloads: defs })
	}

	protected _readState<NewSel extends string = Sel, NewP extends readonly AnyPreloadDef[] = P>(
		next: ReadState<NewSel, NewP> = {} as ReadState<NewSel, NewP>,
	): ReadState<NewSel, NewP> {
		return {
			whereFactories: next.whereFactories ?? [...this._whereFactories],
			select: next.select ?? (this._select as unknown as NewSel[]),
			preloads: next.preloads ?? ([...this._preloads] as unknown as NewP),
		}
	}

	protected abstract _clone<NewSel extends string, NewP extends readonly AnyPreloadDef[]>(
		_next: ReadState<NewSel, NewP>,
	): ReadBuilderFor<this, S, NewSel, NewP>
}

export class SchemaRef<S extends AnySchema> {
	readonly #context: SchemaContext<S>

	constructor(context: SchemaContext<S>) {
		this.#context = context
	}

	one() {
		return new OneBuilder<S, never, []>(this.#context)
	}

	all() {
		return new AllBuilder<S, never, []>(this.#context)
	}

	raw<T = unknown>(command: unknown, params?: unknown[]) {
		return this.#context.use.raw<T>(command, params)
	}
}

export class OneBuilder<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]> extends ReadSelectState<S, Sel, P> {
	declare readonly _builderKind: 'one-read'

	id(value: SchemaPrimaryKeyValue<S>): this {
		this._whereFactories = withIdFilter(this._context, this._whereFactories, value)
		return this
	}

	protected _clone<NewSel extends string, NewP extends readonly AnyPreloadDef[]>(next: ReadState<NewSel, NewP>) {
		return new OneBuilder<S, NewSel, NewP>(
			this._context,
			this._readState({
				whereFactories: next.whereFactories,
				select: next.select,
				preloads: next.preloads,
			}),
		) as any
	}

	insert(data: SchemaInsertInput<S>) {
		return new OneInsertBuilder<S, Sel, P>(this._context, data, {
			select: this._select,
			preloads: this._preloads,
		})
	}

	update(data: SchemaUpdateInput<S>) {
		return new OneUpdateBuilder<S, Sel, P>(this._context, data, {
			whereFactories: [...this._whereFactories],
			select: this._select,
			preloads: this._preloads,
		})
	}

	upsert(data: UpsertInput<S>) {
		return new OneUpsertBuilder<S, Sel, P>(this._context, data, {
			whereFactories: [...this._whereFactories],
			select: this._select,
			preloads: this._preloads,
		})
	}

	delete() {
		return new OneDeleteBuilder<S, Sel, P>(this._context, {
			whereFactories: [...this._whereFactories],
			select: this._select,
			preloads: this._preloads,
		})
	}

	async run(): Promise<SelectedWithPreloads<S, Sel, P> | null> {
		const row = await this._context.use.findOne(toQuerySpec(this._whereFactories))
		if (!row) return null
		return this._context.shapeOneRow(this._select, this._preloads, row)
	}
}

export class AllBuilder<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]> extends ReadSelectState<S, Sel, P> {
	declare readonly _builderKind: 'all-read'

	readonly #orderBy: OrderBy[] = []
	#limit: number | undefined
	#offset: number | undefined

	protected _clone<NewSel extends string, NewP extends readonly AnyPreloadDef[]>(next: ReadState<NewSel, NewP>) {
		const cloned = new AllBuilder<S, NewSel, NewP>(
			this._context,
			this._readState({
				whereFactories: next.whereFactories,
				select: next.select,
				preloads: next.preloads,
			}),
		)
		cloned.#orderBy.push(...this.#orderBy)
		cloned.#limit = this.#limit
		cloned.#offset = this.#offset
		return cloned as any
	}

	orderBy(field: string | AnyField, direction: 'asc' | 'desc' = 'asc') {
		this.#orderBy.push(new OrderBy(field, direction))
		return this
	}

	limit(limit: number) {
		this.#limit = limit
		return this
	}

	offset(offset: number) {
		this.#offset = offset
		return this
	}

	insert(data: SchemaInsertInput<S>[]) {
		return new AllInsertBuilder<S, Sel, P>(this._context, data, {
			select: this._select,
			preloads: this._preloads,
		})
	}

	update(data: SchemaUpdateInput<S>) {
		return new AllUpdateBuilder<S, Sel, P>(this._context, data, {
			whereFactories: [...this._whereFactories],
			select: this._select,
			preloads: this._preloads,
		})
	}

	delete() {
		return new AllDeleteBuilder<S, Sel, P>(this._context, {
			whereFactories: [...this._whereFactories],
			select: this._select,
			preloads: this._preloads,
		})
	}

	async run(): Promise<SelectedWithPreloads<S, Sel, P>[]> {
		const plan = this._context.planSelection(this._select as readonly string[] | undefined)
		const options = queryOptionsForRead(plan.adapterSelect, this.#orderBy, this.#limit, this.#offset)
		const rows = await this._context.use.findMany(toQuerySpec(this._whereFactories), options)
		return this._context.shapeRows(this._select, this._preloads, rows)
	}
}

class WriteSelectState<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]> {
	protected readonly _context: SchemaContext<S>
	protected _select: readonly Sel[] | undefined
	protected _preloads: P

	constructor(context: SchemaContext<S>, state?: WriteState<Sel, P>) {
		this._context = context
		this._select = state?.select
		this._preloads = state?.preloads ?? ([] as unknown as P)
	}

	select<NewSel extends keyof SchemaOutput<S> & string>(fields: readonly NewSel[]): WriteBuilderFor<this, S, NewSel, P> {
		return this._clone<NewSel, P>({ select: fields })
	}

	preload<NewP extends readonly AnyPreloadDef[]>(defs: NewP): WriteBuilderFor<this, S, Sel, NewP> {
		return this._clone<Sel, NewP>({ preloads: defs })
	}

	protected _writeState<NewSel extends string = Sel, NewP extends readonly AnyPreloadDef[] = P>(
		next: WriteState<NewSel, NewP> = {} as WriteState<NewSel, NewP>,
	): WriteState<NewSel, NewP> {
		return {
			select: next.select ?? (this._select as unknown as NewSel[]),
			preloads: next.preloads ?? ([...this._preloads] as unknown as NewP),
		}
	}

	protected _clone<NewSel extends string = Sel, NewP extends readonly AnyPreloadDef[] = P>(
		_next: WriteState<NewSel, NewP>,
	): WriteBuilderFor<this, S, NewSel, NewP> {
		throw new Error('Not implemented')
	}

	protected async _shapeRows(rows: Record<string, unknown>[]): Promise<SelectedWithPreloads<S, Sel, P>[]> {
		return this._context.shapeRows(this._select, this._preloads, rows)
	}

	protected async _shapeOneRow(row: Record<string, unknown> | null): Promise<SelectedWithPreloads<S, Sel, P> | null> {
		return this._context.shapeOneRow(this._select, this._preloads, row)
	}
}

export class OneInsertBuilder<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]> extends WriteSelectState<
	S,
	Sel,
	P
> {
	declare readonly _builderKind: 'one-insert'

	readonly #data: SchemaInsertInput<S>

	constructor(context: SchemaContext<S>, data: SchemaInsertInput<S>, state?: WriteState<Sel, P>) {
		super(context, state)
		this.#data = data
	}

	protected _clone<NewSel extends string = Sel, NewP extends readonly AnyPreloadDef[] = P>(next: WriteState<NewSel, NewP>) {
		return new OneInsertBuilder<S, NewSel, NewP>(
			this._context,
			this.#data,
			this._writeState({
				select: next.select,
				preloads: next.preloads,
			}),
		) as any
	}

	async run(): Promise<SelectedWithPreloads<S, Sel, P>> {
		const validated = validateInsert(this._context.schema, this.#data as any)
		const row = await this._context.use.insertOne(validated as any)
		const [resolved] = await this._shapeRows([row])
		return resolved
	}
}

export class AllInsertBuilder<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]> extends WriteSelectState<
	S,
	Sel,
	P
> {
	declare readonly _builderKind: 'all-insert'

	readonly #data: SchemaInsertInput<S>[]

	constructor(context: SchemaContext<S>, data: SchemaInsertInput<S>[], state?: WriteState<Sel, P>) {
		super(context, state)
		this.#data = data
	}

	protected _clone<NewSel extends string = Sel, NewP extends readonly AnyPreloadDef[] = P>(next: WriteState<NewSel, NewP>) {
		return new AllInsertBuilder<S, NewSel, NewP>(
			this._context,
			this.#data,
			this._writeState({
				select: next.select,
				preloads: next.preloads,
			}),
		) as any
	}

	async run(): Promise<SelectedWithPreloads<S, Sel, P>[]> {
		const validated = this.#data.map((entry) => validateInsert(this._context.schema, entry as any))
		const rows = await this._context.use.insertMany(validated as any)
		return this._shapeRows(rows)
	}
}

class WriteFilterState<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]> extends WriteSelectState<S, Sel, P> {
	protected _whereFactories: WhereFactory[]

	constructor(context: SchemaContext<S>, state?: ReadState<Sel, P>) {
		super(context, state)
		this._whereFactories = state?.whereFactories ?? []
	}

	where(factory: WhereFactory): this {
		this._whereFactories.push(factory)
		return this
	}

	protected _filterState<NewSel extends string = Sel, NewP extends readonly AnyPreloadDef[] = P>(
		next: ReadState<NewSel, NewP> = {} as ReadState<NewSel, NewP>,
	): ReadState<NewSel, NewP> {
		return {
			whereFactories: next.whereFactories ?? [...this._whereFactories],
			...this._writeState(next),
		}
	}
}

export class OneUpdateBuilder<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]> extends WriteFilterState<
	S,
	Sel,
	P
> {
	declare readonly _builderKind: 'one-update'

	readonly #data: SchemaUpdateInput<S>

	constructor(context: SchemaContext<S>, data: SchemaUpdateInput<S>, state?: ReadState<Sel, P>) {
		super(context, state)
		this.#data = data
	}

	id(value: SchemaPrimaryKeyValue<S>): this {
		this._whereFactories = withIdFilter(this._context, this._whereFactories, value)
		return this
	}

	protected _clone<NewSel extends string = Sel, NewP extends readonly AnyPreloadDef[] = P>(next: WriteState<NewSel, NewP>) {
		return new OneUpdateBuilder<S, NewSel, NewP>(
			this._context,
			this.#data,
			this._filterState({
				whereFactories: [...this._whereFactories],
				select: next.select,
				preloads: next.preloads,
			}),
		) as any
	}

	async run(): Promise<SelectedWithPreloads<S, Sel, P> | null> {
		const validated = validateUpdate(this._context.schema, this.#data)
		const row = await this._context.use.updateOne(toQuerySpec(this._whereFactories), validated)
		return this._shapeOneRow(row)
	}
}

export class AllUpdateBuilder<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]> extends WriteFilterState<
	S,
	Sel,
	P
> {
	declare readonly _builderKind: 'all-update'

	readonly #data: SchemaUpdateInput<S>

	constructor(context: SchemaContext<S>, data: SchemaUpdateInput<S>, state?: ReadState<Sel, P>) {
		super(context, state)
		this.#data = data
	}

	protected _clone<NewSel extends string = Sel, NewP extends readonly AnyPreloadDef[] = P>(next: WriteState<NewSel, NewP>) {
		return new AllUpdateBuilder<S, NewSel, NewP>(
			this._context,
			this.#data,
			this._filterState({
				whereFactories: [...this._whereFactories],
				select: next.select,
				preloads: next.preloads,
			}),
		) as any
	}

	async run(): Promise<SelectedWithPreloads<S, Sel, P>[]> {
		const validated = validateUpdate(this._context.schema, this.#data)
		const rows = await this._context.use.updateMany(toQuerySpec(this._whereFactories), validated)
		return this._shapeRows(rows)
	}
}

export class OneUpsertBuilder<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]> extends WriteFilterState<
	S,
	Sel,
	P
> {
	declare readonly _builderKind: 'one-upsert'

	readonly #data: UpsertInput<S>

	constructor(context: SchemaContext<S>, data: UpsertInput<S>, state?: ReadState<Sel, P>) {
		super(context, state)
		this.#data = data
	}

	protected _clone<NewSel extends string = Sel, NewP extends readonly AnyPreloadDef[] = P>(next: WriteState<NewSel, NewP>) {
		return new OneUpsertBuilder<S, NewSel, NewP>(
			this._context,
			this.#data,
			this._filterState({
				whereFactories: [...this._whereFactories],
				select: next.select,
				preloads: next.preloads,
			}),
		) as any
	}

	async run(): Promise<SelectedWithPreloads<S, Sel, P>> {
		const insert = validateInsert(this._context.schema, this.#data.insert as Record<string, unknown>)
		const update = 'update' in this.#data ? validateUpdate(this._context.schema, this.#data.update) : undefined
		const row = await this._context.use.upsertOne(toQuerySpec(this._whereFactories), update ? ({ insert, update } as any) : { insert })
		return (await this._shapeOneRow(row)) as SelectedWithPreloads<S, Sel, P>
	}
}

export class OneDeleteBuilder<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]> extends WriteFilterState<
	S,
	Sel,
	P
> {
	declare readonly _builderKind: 'one-delete'

	id(value: SchemaPrimaryKeyValue<S>): this {
		this._whereFactories = withIdFilter(this._context, this._whereFactories, value)
		return this
	}

	protected _clone<NewSel extends string = Sel, NewP extends readonly AnyPreloadDef[] = P>(next: WriteState<NewSel, NewP>) {
		return new OneDeleteBuilder<S, NewSel, NewP>(
			this._context,
			this._filterState({
				whereFactories: [...this._whereFactories],
				select: next.select,
				preloads: next.preloads,
			}),
		) as any
	}

	constructor(context: SchemaContext<S>, state?: ReadState<Sel, P>) {
		super(context, state)
	}

	async run(): Promise<SelectedWithPreloads<S, Sel, P> | null> {
		const row = await this._context.use.deleteOne(toQuerySpec(this._whereFactories))
		return this._shapeOneRow(row)
	}
}

export class AllDeleteBuilder<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]> extends WriteFilterState<
	S,
	Sel,
	P
> {
	declare readonly _builderKind: 'all-delete'

	protected _clone<NewSel extends string = Sel, NewP extends readonly AnyPreloadDef[] = P>(next: WriteState<NewSel, NewP>) {
		return new AllDeleteBuilder<S, NewSel, NewP>(
			this._context,
			this._filterState({
				whereFactories: [...this._whereFactories],
				select: next.select,
				preloads: next.preloads,
			}),
		) as any
	}

	constructor(context: SchemaContext<S>, state?: ReadState<Sel, P>) {
		super(context, state)
	}

	async run(): Promise<SelectedWithPreloads<S, Sel, P>[]> {
		const rows = await this._context.use.deleteMany(toQuerySpec(this._whereFactories))
		return this._shapeRows(rows)
	}
}
