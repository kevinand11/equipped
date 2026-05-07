import type { InferRawArgs, InferRawReturn } from '../adapter'
import type { OrmUse } from '../adapters/base'
import type { AnyField } from '../fields'
import { FilterGroup, type FilterFactory } from '../filter'
import { OrderBy } from '../query'
import type { AnyPreloadDef } from '../relations'
import type { AnySchema, SchemaOutput } from '../schema'
import type { SchemaCreateInput, SchemaUpdateInput } from '../schema-validations'
import { applyComputedSelection, planSelection } from './internals/computeds'
import {
	runAllCreate,
	runAllDelete,
	runAllRead,
	runAllUpdate,
	runOneCreate,
	runOneDelete,
	runOneRead,
	runOneUpdate,
	runOneUpsert,
} from './internals/executors'
import { resolvePreloads } from './internals/preloads'
import type { SelectedWithPreloads } from './internals/types'

type SchemaPrimaryKeyValue<S extends AnySchema> = SchemaOutput<S>[S['pkField']['name'] & keyof SchemaOutput<S>]
export type UpsertInput<S extends AnySchema> = { create: SchemaCreateInput<S> } | { create: SchemaCreateInput<S>; update: SchemaUpdateInput<S> }
type ReadState<Sel extends string, P extends readonly AnyPreloadDef[] = readonly AnyPreloadDef[]> = {
	where?: FilterGroup
	select?: readonly Sel[]
	preloads?: P
}

export type HasMethod<A, _Bag extends string, Method extends string> =
	Method extends keyof A
		? A[Method] extends (...args: any) => any
			? true
			: false
		: false

export type OneBuilderSurface<S extends AnySchema, A = unknown, Sel extends string = never, P extends readonly AnyPreloadDef[] = []> =
	OneBuilder<S, A, Sel, P> &
	(HasMethod<A, 'queryable', 'updateMany'> extends true ? {} : { update: never }) &
	(HasMethod<A, 'queryable', 'deleteMany'> extends true ? {} : { delete: never }) &
	(HasMethod<A, 'queryable', 'upsertOne'> extends true ? {} : { upsert: never })

export type AllBuilderSurface<S extends AnySchema, A = unknown, Sel extends string = never, P extends readonly AnyPreloadDef[] = []> =
	AllBuilder<S, A, Sel, P> &
	(HasMethod<A, 'queryable', 'updateMany'> extends true ? {} : { update: never }) &
	(HasMethod<A, 'queryable', 'deleteMany'> extends true ? {} : { delete: never })

export type SchemaRefSurface<S extends AnySchema, A = unknown> =
	Omit<SchemaRef<S, A>, 'raw'> &
	(HasMethod<A, 'crud', 'raw'> extends true
		? { raw: <T = InferRawReturn<A>>(...args: InferRawArgs<A>) => Promise<T> }
		: { raw: never })

type ReadBuilderFor<TBuilder, S extends AnySchema, A, Sel extends string, P extends readonly AnyPreloadDef[]> = TBuilder extends {
	_builderKind: 'one'
}
	? OneBuilderSurface<S, A, Sel, P>
	: TBuilder extends { _builderKind: 'all' }
		? AllBuilderSurface<S, A, Sel, P>
		: never

export class SchemaContext<S extends AnySchema> {
	constructor(
		readonly schema: S,
		private readonly getUse: (target: AnySchema) => OrmUse,
	) {}

	async shapeRows<Sel extends string, P extends readonly AnyPreloadDef[]>(
		select: readonly Sel[] | undefined,
		preloads: P,
		rows: Record<string, unknown>[],
	): Promise<SelectedWithPreloads<S, Sel, P>[]> {
		const plan = planSelection(this.schema, select)
		const selected = applyComputedSelection(this.schema, rows, plan)
		if (preloads.length === 0) return selected as SelectedWithPreloads<S, Sel, P>[]
		return (await resolvePreloads(selected, preloads, this.getUse)) as SelectedWithPreloads<S, Sel, P>[]
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

abstract class ReadSelectState<S extends AnySchema, A = unknown, Sel extends string = never, P extends readonly AnyPreloadDef[] = []> {
	protected readonly _context: SchemaContext<S>
	protected _where: FilterGroup
	protected _select: readonly Sel[] | undefined
	protected _preloads: P

	constructor(context: SchemaContext<S>, state?: ReadState<Sel, P>) {
		this._context = context
		this._where = state?.where ? state.where.clone() : FilterGroup.create()
		this._select = state?.select
		this._preloads = state?.preloads ?? ([] as unknown as P)
	}

	where(factory: FilterFactory): this {
		const nextGroup = factory(this._where.clone())
		return this._clone<Sel, P>({
			where: nextGroup,
			select: this._select as readonly Sel[] | undefined,
			preloads: this._preloads,
		}) as unknown as this
	}

	select<NewSel extends keyof SchemaOutput<S> & string>(fields: readonly NewSel[]): ReadBuilderFor<this, S, A, NewSel, P> {
		return this._clone<NewSel, P>({ select: fields })
	}

	preload<NewP extends readonly AnyPreloadDef[]>(defs: NewP): ReadBuilderFor<this, S, A, Sel, NewP> {
		return this._clone<Sel, NewP>({ preloads: defs })
	}

	protected _readState<NewSel extends string = Sel, NewP extends readonly AnyPreloadDef[] = P>(
		next: ReadState<NewSel, NewP> = {} as ReadState<NewSel, NewP>,
	): ReadState<NewSel, NewP> {
		return {
			where: next.where ?? this._where.clone(),
			select: next.select ?? (this._select as unknown as NewSel[]),
			preloads: next.preloads ?? ([...this._preloads] as unknown as NewP),
		}
	}

	protected abstract _clone<NewSel extends string, NewP extends readonly AnyPreloadDef[]>(
		_next: ReadState<NewSel, NewP>,
	): ReadBuilderFor<this, S, A, NewSel, NewP>
}

export class SchemaRef<S extends AnySchema, A = unknown> {
	readonly #context: SchemaContext<S>

	constructor(context: SchemaContext<S>) {
		this.#context = context
	}

	one(): OneBuilderSurface<S, A, never, []> {
		return new OneBuilder<S, A, never, []>(this.#context) as OneBuilderSurface<S, A, never, []>
	}

	all(): AllBuilderSurface<S, A, never, []> {
		return new AllBuilder<S, A, never, []>(this.#context) as AllBuilderSurface<S, A, never, []>
	}

	raw(...args: any[]) {
		return this.#context.use.raw(...args)
	}
}

export class OneBuilder<S extends AnySchema, A = unknown, Sel extends string = never, P extends readonly AnyPreloadDef[] = []> extends ReadSelectState<S, A, Sel, P> {
	declare readonly _builderKind: 'one'

	id(value: SchemaPrimaryKeyValue<S>): this {
		const nextGroup = this._where.clone().eq(this._context.schema.pkField, value)
		return this._clone<Sel, P>({
			where: nextGroup,
			select: this._select as readonly Sel[] | undefined,
			preloads: this._preloads,
		}) as this
	}

	protected _clone<NewSel extends string, NewP extends readonly AnyPreloadDef[]>(next: ReadState<NewSel, NewP>) {
		return new OneBuilder<S, A, NewSel, NewP>(
			this._context,
			this._readState({
				where: next.where,
				select: next.select,
				preloads: next.preloads,
			}),
		) as any
	}

	create(data: SchemaCreateInput<S>) {
		return runOneCreate(
			this._context,
			{
				select: this._select,
				preloads: this._preloads,
			},
			data,
		)
	}

	update(data: SchemaUpdateInput<S>) {
		return runOneUpdate(
			this._context,
			{
				where: this._where,
				select: this._select,
				preloads: this._preloads,
			},
			data,
		)
	}

	upsert(data: UpsertInput<S>) {
		return runOneUpsert(
			this._context,
			{
				where: this._where,
				select: this._select,
				preloads: this._preloads,
			},
			data,
		)
	}

	delete() {
		return runOneDelete(this._context, {
			where: this._where,
			select: this._select,
			preloads: this._preloads,
		})
	}

	find() {
		return runOneRead(this._context, {
			where: this._where,
			select: this._select,
			preloads: this._preloads,
		})
	}
}

export class AllBuilder<S extends AnySchema, A = unknown, Sel extends string = never, P extends readonly AnyPreloadDef[] = []> extends ReadSelectState<S, A, Sel, P> {
	declare readonly _builderKind: 'all'

	#orderBy: OrderBy[]
	#limit: number | undefined
	#offset: number | undefined

	constructor(
		context: SchemaContext<S>,
		state?: ReadState<Sel, P>,
		queryState?: { orderBy?: OrderBy[]; limit?: number; offset?: number },
	) {
		super(context, state)
		this.#orderBy = queryState?.orderBy ?? []
		this.#limit = queryState?.limit
		this.#offset = queryState?.offset
	}

	#queryState() {
		return { orderBy: [...this.#orderBy], limit: this.#limit, offset: this.#offset }
	}

	protected _clone<NewSel extends string, NewP extends readonly AnyPreloadDef[]>(next: ReadState<NewSel, NewP>) {
		return new AllBuilder<S, A, NewSel, NewP>(
			this._context,
			this._readState({
				where: next.where,
				select: next.select,
				preloads: next.preloads,
			}),
			this.#queryState(),
		) as any
	}

	orderBy(field: string | AnyField, direction: 'asc' | 'desc' = 'asc') {
		return new AllBuilder<S, A, Sel, P>(
			this._context,
			this._readState({
				where: this._where.clone(),
				select: this._select as readonly Sel[] | undefined,
				preloads: this._preloads,
			}),
			{ orderBy: [...this.#orderBy, new OrderBy(field, direction)], limit: this.#limit, offset: this.#offset },
		) as this
	}

	limit(limit: number) {
		return new AllBuilder<S, A, Sel, P>(
			this._context,
			this._readState({
				where: this._where.clone(),
				select: this._select as readonly Sel[] | undefined,
				preloads: this._preloads,
			}),
			{ orderBy: [...this.#orderBy], limit, offset: this.#offset },
		) as this
	}

	offset(offset: number) {
		return new AllBuilder<S, A, Sel, P>(
			this._context,
			this._readState({
				where: this._where.clone(),
				select: this._select as readonly Sel[] | undefined,
				preloads: this._preloads,
			}),
			{ orderBy: [...this.#orderBy], limit: this.#limit, offset },
		) as this
	}

	create(data: SchemaCreateInput<S>[]) {
		return runAllCreate(
			this._context,
			{
				select: this._select,
				preloads: this._preloads,
			},
			data,
		)
	}

	update(data: SchemaUpdateInput<S>) {
		return runAllUpdate(
			this._context,
			{
				where: this._where,
				select: this._select,
				preloads: this._preloads,
			},
			data,
		)
	}

	delete() {
		return runAllDelete(this._context, {
			where: this._where,
			select: this._select,
			preloads: this._preloads,
		})
	}

	find() {
		return runAllRead(this._context, {
			where: this._where,
			select: this._select,
			preloads: this._preloads,
			orderBy: this.#orderBy,
			limit: this.#limit,
			offset: this.#offset,
		})
	}
}

if (import.meta.vitest) {
	const { describe, test, expect, beforeEach } = import.meta.vitest
	const { v } = await import('valleyed')
	const { InMemoryAdapter } = await import('../adapters/in-memory')
	const { Repo } = await import('./repo')
	const { Schema } = await import('../schema')

	describe('builders', () => {
		let repo: any
		beforeEach(() => {
			const adapter = InMemoryAdapter.create({})
			repo = Repo.from(adapter).resolve((s) => ({ table: s.name })).build()
		})

		test('update() executes and returns updated row', async () => {
			const UserSchema = Schema.from('users')
				.pk('id', v.string(), () => `u-${Math.random().toString(36).slice(2, 8)}`)
				.field('email', v.string())
				.field('name', v.string())
				.build()

			const created = await repo.on(UserSchema).one().create({ email: 'up@test.com', name: 'Before' })
			const updated = await repo.on(UserSchema).one().id(created.id).update({ name: 'After' })
			expect(updated?.name).toBe('After')
			const found = await repo.on(UserSchema).one().id(created.id).find()
			expect(found?.name).toBe('After')
		})

		test('find() returns rows', async () => {
			const UserSchema = Schema.from('users')
				.pk('id', v.string(), () => `u-${Math.random().toString(36).slice(2, 8)}`)
				.field('email', v.string())
				.field('name', v.string())
				.build()

			await repo
				.on(UserSchema)
				.all()
				.create([
					{ email: 'a@x.com', name: 'Alice' },
					{ email: 'b@x.com', name: 'Bob' },
				])

			const rows = await repo
				.on(UserSchema)
				.all()
				.where((q) => q.or([(g) => g.eq('name', 'Alice'), (g) => g.eq('name', 'Bob')]))
				.find()
			expect(rows).toHaveLength(2)
		})

		test('write branches do not leak filters', async () => {
			const UserSchema = Schema.from('users')
				.pk('id', v.string(), () => `u-${Math.random().toString(36).slice(2, 8)}`)
				.field('email', v.string())
				.field('name', v.string())
				.build()

			await repo
				.on(UserSchema)
				.all()
				.create([
					{ email: 'alice@x.com', name: 'Alice' },
					{ email: 'bob@x.com', name: 'Bob' },
				])

			const base = repo.on(UserSchema).all()
			await base.where((q) => q.eq('name', 'Alice')).update({ name: 'A Updated' })
			await base.where((q) => q.eq('name', 'Bob')).update({ name: 'B Updated' })

			const all = await repo.on(UserSchema).all().orderBy('name', 'asc').find()
			expect(all.map((r) => r.name)).toEqual(['A Updated', 'B Updated'])
		})
	})
}
