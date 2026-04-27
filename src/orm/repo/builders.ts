import type { OrmUse } from '../adapters/base'
import type { AnyField } from '../fields'
import type { OrderBy } from '../query'
import type { AnyPreloadDef } from '../relations'
import type { AnySchema, SchemaOutput } from '../schema'
import type { SchemaInsertInput, SchemaUpdateInput } from '../schema-validations'
import { applyComputedSelection } from './internal/computed-projector'
import { runAllRead, runOneRead } from './internal/executors/read-executor'
import {
	runAllDelete,
	runAllInsert,
	runAllUpdate,
	runOneDelete,
	runOneInsert,
	runOneUpdate,
	runOneUpsert,
} from './internal/executors/write-executor'
import { resolveRowsPreloads } from './internal/preload-resolver'
import type { ComputedSelectionPlan } from './internal/selection-planner'
import { planSelection } from './internal/selection-planner'
import { appendOrderBy, appendWhere, type WhereFactory } from './internal/state'
import type { SelectedWithPreloads } from './types'

export type { ComputedSelectionPlan } from './internal/selection-planner'

type SchemaPrimaryKeyValue<S extends AnySchema> = SchemaOutput<S>[S['pkField']['name'] & keyof SchemaOutput<S>]

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
		return planSelection(this.schema, select)
	}

	#applySelection(rows: Record<string, unknown>[], plan: ComputedSelectionPlan) {
		return applyComputedSelection(this.schema, rows, plan)
	}

	#resolvePreloads(rows: Record<string, unknown>[], preloads: readonly AnyPreloadDef[]) {
		return resolveRowsPreloads(rows, preloads, this.getUse)
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

function withIdFilter<S extends AnySchema>(
	context: SchemaContext<S>,
	where: readonly WhereFactory[],
	id: SchemaPrimaryKeyValue<S>,
): WhereFactory[] {
	return appendWhere(where, (q) => q.eq(context.schema.pkField, id))
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
		return this._clone<Sel, P>({
			whereFactories: appendWhere(this._whereFactories, factory),
			select: this._select as readonly Sel[] | undefined,
			preloads: this._preloads,
		}) as unknown as this
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
		return this._clone<Sel, P>({
			whereFactories: withIdFilter(this._context, this._whereFactories, value),
			select: this._select as readonly Sel[] | undefined,
			preloads: this._preloads,
		}) as this
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
		return runOneRead(this._context, {
			whereFactories: this._whereFactories,
			select: this._select,
			preloads: this._preloads,
		})
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
		const cloned = this._clone<Sel, P>({
			whereFactories: [...this._whereFactories],
			select: this._select as readonly Sel[] | undefined,
			preloads: this._preloads,
		}) as AllBuilder<S, Sel, P>
		cloned.#orderBy.length = 0
		cloned.#orderBy.push(...appendOrderBy(this.#orderBy, field, direction))
		return cloned as this
	}

	limit(limit: number) {
		const cloned = this._clone<Sel, P>({
			whereFactories: [...this._whereFactories],
			select: this._select as readonly Sel[] | undefined,
			preloads: this._preloads,
		}) as AllBuilder<S, Sel, P>
		cloned.#limit = limit
		return cloned as this
	}

	offset(offset: number) {
		const cloned = this._clone<Sel, P>({
			whereFactories: [...this._whereFactories],
			select: this._select as readonly Sel[] | undefined,
			preloads: this._preloads,
		}) as AllBuilder<S, Sel, P>
		cloned.#offset = offset
		return cloned as this
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
		return runAllRead(this._context, {
			whereFactories: this._whereFactories,
			select: this._select,
			preloads: this._preloads,
			orderBy: this.#orderBy,
			limit: this.#limit,
			offset: this.#offset,
		})
	}
}

abstract class WriteSelectState<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]> {
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

	protected abstract _clone<NewSel extends string = Sel, NewP extends readonly AnyPreloadDef[] = P>(
		_next: WriteState<NewSel, NewP>,
	): WriteBuilderFor<this, S, NewSel, NewP>

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
		return runOneInsert(
			this._context,
			{
				select: this._select,
				preloads: this._preloads,
			},
			this.#data,
		)
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
		return runAllInsert(
			this._context,
			{
				select: this._select,
				preloads: this._preloads,
			},
			this.#data,
		)
	}
}

abstract class WriteFilterState<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]> extends WriteSelectState<
	S,
	Sel,
	P
> {
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
		return runOneUpdate(
			this._context,
			{
				whereFactories: this._whereFactories,
				select: this._select,
				preloads: this._preloads,
			},
			this.#data,
		)
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
		return runAllUpdate(
			this._context,
			{
				whereFactories: this._whereFactories,
				select: this._select,
				preloads: this._preloads,
			},
			this.#data,
		)
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
		return runOneUpsert(
			this._context,
			{
				whereFactories: this._whereFactories,
				select: this._select,
				preloads: this._preloads,
			},
			this.#data,
		)
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
		return runOneDelete(this._context, {
			whereFactories: this._whereFactories,
			select: this._select,
			preloads: this._preloads,
		})
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
		return runAllDelete(this._context, {
			whereFactories: this._whereFactories,
			select: this._select,
			preloads: this._preloads,
		})
	}
}
