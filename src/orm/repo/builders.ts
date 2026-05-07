import type { InferRawArgs, InferRawReturn } from '../adapter'
import type { OrmUse } from '../adapters/base'
import { OrmNotFoundError, type OrmNotFoundOperation } from '../errors'
import { toFieldName, type AnyField, type Field } from '../fields'
import { FilterGroup, type FilterFactory } from '../filter'
import type { AggregateSpec } from '../orm-adapter'
import { OrderBy } from '../query'
import type { AnyPreloadDef } from '../relations'
import type { AnySchema, SchemaOutput } from '../schema'
import type { SchemaCreateInput, SchemaUpdateInput } from '../schema-validations'
import { applyComputedSelection, planSelection } from './internals/computeds'
import {
	runAggregate,
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

type MaybeNull<T, Req extends boolean> = Req extends true ? T : T | null
type SchemaPrimaryKeyValue<S extends AnySchema> = SchemaOutput<S>[S['pkField']['name'] & keyof SchemaOutput<S>]
export type UpsertInput<S extends AnySchema> = { create: SchemaCreateInput<S> } | { create: SchemaCreateInput<S>; update: SchemaUpdateInput<S> }
type ReadState<Sel extends string, P extends readonly AnyPreloadDef[] = readonly AnyPreloadDef[]> = {
	where?: FilterGroup
	select?: readonly Sel[]
	preloads?: P
}

export type HasMethod<A, Method extends string> =
	Method extends keyof A
		? A[Method] extends (...args: any) => any
			? true
			: false
		: false

export type OneBuilderSurface<S extends AnySchema, A = unknown, Sel extends string = never, P extends readonly AnyPreloadDef[] = [], Req extends boolean = false> =
	OneBuilder<S, A, Sel, P, Req> &
	(HasMethod<A, 'updateMany'> extends true ? {} : { update: never }) &
	(HasMethod<A, 'deleteMany'> extends true ? {} : { delete: never }) &
	(HasMethod<A, 'upsertOne'> extends true ? {} : { upsert: never })

export type AllBuilderSurface<S extends AnySchema, A = unknown, Sel extends string = never, P extends readonly AnyPreloadDef[] = []> =
	AllBuilder<S, A, Sel, P> &
	(HasMethod<A, 'updateMany'> extends true ? {} : { update: never }) &
	(HasMethod<A, 'deleteMany'> extends true ? {} : { delete: never })

type HasNonEmptyAggregateOps<A> = A extends { aggregateOps: readonly [any, ...any[]] } ? true : false

export type SchemaRefSurface<S extends AnySchema, A = unknown> =
	Omit<SchemaRef<S, A>, 'raw' | 'aggregate'> &
	(HasMethod<A, 'raw'> extends true
		? { raw: <T = InferRawReturn<A>>(...args: InferRawArgs<A>) => Promise<T> }
		: { raw: never }) &
	([HasMethod<A, 'aggregate'>, HasNonEmptyAggregateOps<A>] extends [true, true]
		? { aggregate: SchemaRef<S, A>['aggregate'] }
		: { aggregate: never })

type ReadBuilderFor<TBuilder, S extends AnySchema, A, Sel extends string, P extends readonly AnyPreloadDef[]> = TBuilder extends {
	_builderKind: 'one'
	_req: infer Req extends boolean
}
	? OneBuilderSurface<S, A, Sel, P, Req>
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

	aggregate(): AggregateBuilder<S, A, {}, {}, false, false, false> {
		return new AggregateBuilder<S, A, {}, {}, false, false, false>(this.#context)
	}

	raw(...args: any[]) {
		return this.#context.use.raw(...args)
	}
}

export class OneBuilder<S extends AnySchema, A = unknown, Sel extends string = never, P extends readonly AnyPreloadDef[] = [], Req extends boolean = false> extends ReadSelectState<S, A, Sel, P> {
	declare readonly _builderKind: 'one'
	declare readonly _req: Req

	protected _required: boolean
	protected _requiredMessage: string | undefined

	constructor(context: SchemaContext<S>, state?: ReadState<Sel, P>, reqState?: { required: boolean; message?: string }) {
		super(context, state)
		this._required = reqState?.required ?? false
		this._requiredMessage = reqState?.message
	}

	id(value: SchemaPrimaryKeyValue<S>): this {
		const nextGroup = this._where.clone().eq(this._context.schema.pkField, value)
		return this._clone<Sel, P>({
			where: nextGroup,
			select: this._select as readonly Sel[] | undefined,
			preloads: this._preloads,
		}) as this
	}

	required(this: OneBuilder<S, A, Sel, P, false>, message?: string): OneBuilderSurface<S, A, Sel, P, true> {
		return new OneBuilder<S, A, Sel, P, true>(this._context, this._readState(), { required: true, message }) as OneBuilderSurface<S, A, Sel, P, true>
	}

	private _assertFound(result: unknown, operation: OrmNotFoundOperation): void {
		if (this._required && result === null) {
			throw new OrmNotFoundError({ schema: this._context.schema.name, operation, where: this._where, message: this._requiredMessage })
		}
	}

	protected _clone<NewSel extends string, NewP extends readonly AnyPreloadDef[]>(next: ReadState<NewSel, NewP>) {
		return new OneBuilder<S, A, NewSel, NewP, Req>(this._context, this._readState(next), { required: this._required, message: this._requiredMessage }) as any
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

	async update(data: SchemaUpdateInput<S>): Promise<MaybeNull<SelectedWithPreloads<S, Sel, P>, Req>> {
		const result = await runOneUpdate(
			this._context,
			{
				where: this._where,
				select: this._select,
				preloads: this._preloads,
			},
			data,
		)
		this._assertFound(result, 'updateOne')
		return result as any
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

	async delete(): Promise<MaybeNull<SelectedWithPreloads<S, Sel, P>, Req>> {
		const result = await runOneDelete(this._context, {
			where: this._where,
			select: this._select,
			preloads: this._preloads,
		})
		this._assertFound(result, 'deleteOne')
		return result as any
	}

	async find(): Promise<MaybeNull<SelectedWithPreloads<S, Sel, P>, Req>> {
		const result = await runOneRead(this._context, {
			where: this._where,
			select: this._select,
			preloads: this._preloads,
		})
		this._assertFound(result, 'findOne')
		return result as any
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

	#withQuery(queryOverride: Partial<{ orderBy: OrderBy[]; limit: number; offset: number }>) {
		return new AllBuilder<S, A, Sel, P>(
			this._context,
			this._readState(),
			{
				orderBy: queryOverride.orderBy ?? [...this.#orderBy],
				limit: queryOverride.limit ?? this.#limit,
				offset: queryOverride.offset ?? this.#offset,
			},
		) as this
	}

	protected _clone<NewSel extends string, NewP extends readonly AnyPreloadDef[]>(next: ReadState<NewSel, NewP>) {
		return new AllBuilder<S, A, NewSel, NewP>(
			this._context,
			this._readState({
				where: next.where,
				select: next.select,
				preloads: next.preloads,
			}),
			{ orderBy: [...this.#orderBy], limit: this.#limit, offset: this.#offset },
		) as any
	}

	orderBy(field: string | AnyField, direction: 'asc' | 'desc' = 'asc') {
		return this.#withQuery({ orderBy: [...this.#orderBy, new OrderBy(field, direction)] })
	}

	limit(limit: number) {
		return this.#withQuery({ limit })
	}

	offset(offset: number) {
		return this.#withQuery({ offset })
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

type AggregateEntry = AggregateSpec['aggregates'][number]

type FieldsToGroupKeys<F extends readonly AnyField[]> = {
	[E in F[number] as E extends Field<any, infer N> ? N : never]: E extends Field<infer V> ? V : never
}

export class AggregateBuilder<
	S extends AnySchema,
	A = unknown,
	Aggs = {},
	GroupKeys = {},
	HasGroupBy extends boolean = false,
	HasWhere extends boolean = false,
	HasHaving extends boolean = false,
> {
	readonly #context: SchemaContext<S>
	readonly #where: FilterGroup
	readonly #having: FilterGroup
	readonly #aggregates: readonly AggregateEntry[]
	readonly #groupBy: readonly string[]

	constructor(
		context: SchemaContext<S>,
		state?: { where?: FilterGroup; having?: FilterGroup; aggregates?: readonly AggregateEntry[]; groupBy?: readonly string[] },
	) {
		this.#context = context
		this.#where = state?.where ? state.where.clone() : FilterGroup.create()
		this.#having = state?.having ? state.having.clone() : FilterGroup.create()
		this.#aggregates = state?.aggregates ?? []
		this.#groupBy = state?.groupBy ?? []
	}

	where(
		...args: HasWhere extends true ? [never] : [factory: FilterFactory]
	): AggregateBuilder<S, A, Aggs, GroupKeys, HasGroupBy, true, HasHaving> {
		const factory = args[0] as FilterFactory
		const nextGroup = factory(this.#where.clone())
		return new AggregateBuilder<S, A, Aggs, GroupKeys, HasGroupBy, true, HasHaving>(this.#context, {
			where: nextGroup,
			having: this.#having,
			aggregates: this.#aggregates,
			groupBy: this.#groupBy,
		})
	}

	having(
		...args: HasHaving extends true ? [never] : [factory: FilterFactory]
	): AggregateBuilder<S, A, Aggs, GroupKeys, HasGroupBy, HasWhere, true> {
		const factory = args[0] as FilterFactory
		const nextGroup = factory(this.#having.clone())
		return new AggregateBuilder<S, A, Aggs, GroupKeys, HasGroupBy, HasWhere, true>(this.#context, {
			where: this.#where,
			having: nextGroup,
			aggregates: this.#aggregates,
			groupBy: this.#groupBy,
		})
	}

	groupBy<F extends readonly Field<string | number | boolean | Date>[]>(
		...fields: HasGroupBy extends true ? [never] : [...F]
	): AggregateBuilder<S, A, Aggs, GroupKeys & FieldsToGroupKeys<F>, true, HasWhere, HasHaving> {
		const names = (fields as readonly AnyField[]).map((f) => toFieldName(f))
		return new AggregateBuilder<S, A, Aggs, GroupKeys & FieldsToGroupKeys<F>, true, HasWhere, HasHaving>(this.#context, {
			where: this.#where,
			having: this.#having,
			aggregates: this.#aggregates,
			groupBy: names,
		})
	}

	count<K extends string>(
		...[alias]: K extends keyof Aggs ? [never] : [alias: K]
	): AggregateBuilder<S, A, Aggs & Record<K, number>, GroupKeys, HasGroupBy, HasWhere, HasHaving> {
		return new AggregateBuilder<S, A, Aggs & Record<K, number>, GroupKeys, HasGroupBy, HasWhere, HasHaving>(this.#context, {
			where: this.#where,
			having: this.#having,
			aggregates: [...this.#aggregates, { fn: 'count', alias: alias as string }],
			groupBy: this.#groupBy,
		})
	}

	countDistinct<K extends string>(
		field: AnyField,
		...[alias]: K extends keyof Aggs ? [never] : [alias: K]
	): AggregateBuilder<S, A, Aggs & Record<K, number>, GroupKeys, HasGroupBy, HasWhere, HasHaving> {
		return new AggregateBuilder<S, A, Aggs & Record<K, number>, GroupKeys, HasGroupBy, HasWhere, HasHaving>(this.#context, {
			where: this.#where,
			having: this.#having,
			aggregates: [...this.#aggregates, { fn: 'countDistinct', field: toFieldName(field), alias: alias as string }],
			groupBy: this.#groupBy,
		})
	}

	sum<K extends string>(
		field: Field<number>,
		...[alias]: K extends keyof Aggs ? [never] : [alias: K]
	): AggregateBuilder<S, A, Aggs & Record<K, number>, GroupKeys, HasGroupBy, HasWhere, HasHaving> {
		return new AggregateBuilder<S, A, Aggs & Record<K, number>, GroupKeys, HasGroupBy, HasWhere, HasHaving>(this.#context, {
			where: this.#where,
			having: this.#having,
			aggregates: [...this.#aggregates, { fn: 'sum', field: toFieldName(field), alias: alias as string }],
			groupBy: this.#groupBy,
		})
	}

	avg<K extends string>(
		field: Field<number>,
		...[alias]: K extends keyof Aggs ? [never] : [alias: K]
	): AggregateBuilder<S, A, Aggs & Record<K, number>, GroupKeys, HasGroupBy, HasWhere, HasHaving> {
		return new AggregateBuilder<S, A, Aggs & Record<K, number>, GroupKeys, HasGroupBy, HasWhere, HasHaving>(this.#context, {
			where: this.#where,
			having: this.#having,
			aggregates: [...this.#aggregates, { fn: 'avg', field: toFieldName(field), alias: alias as string }],
			groupBy: this.#groupBy,
		})
	}

	min<F extends Field<number | string | Date>, K extends string>(
		field: F,
		...[alias]: K extends keyof Aggs ? [never] : [alias: K]
	): AggregateBuilder<S, A, Aggs & Record<K, F extends Field<infer V> ? V : never>, GroupKeys, HasGroupBy, HasWhere, HasHaving> {
		return new AggregateBuilder<S, A, Aggs & Record<K, F extends Field<infer V> ? V : never>, GroupKeys, HasGroupBy, HasWhere, HasHaving>(this.#context, {
			where: this.#where,
			having: this.#having,
			aggregates: [...this.#aggregates, { fn: 'min', field: toFieldName(field), alias: alias as string }],
			groupBy: this.#groupBy,
		})
	}

	max<F extends Field<number | string | Date>, K extends string>(
		field: F,
		...[alias]: K extends keyof Aggs ? [never] : [alias: K]
	): AggregateBuilder<S, A, Aggs & Record<K, F extends Field<infer V> ? V : never>, GroupKeys, HasGroupBy, HasWhere, HasHaving> {
		return new AggregateBuilder<S, A, Aggs & Record<K, F extends Field<infer V> ? V : never>, GroupKeys, HasGroupBy, HasWhere, HasHaving>(this.#context, {
			where: this.#where,
			having: this.#having,
			aggregates: [...this.#aggregates, { fn: 'max', field: toFieldName(field), alias: alias as string }],
			groupBy: this.#groupBy,
		})
	}

	async run(
		..._: [keyof Aggs] extends [never] ? [never] : []
	): Promise<HasGroupBy extends true ? (Aggs & GroupKeys)[] : Aggs> {
		const spec: AggregateSpec = {
			aggregates: this.#aggregates,
			groupBy: this.#groupBy,
		}
		if (this.#where.children.length > 0) {
			spec.where = this.#where
		}
		if (this.#having.children.length > 0) {
			spec.having = this.#having
		}
		const rows = await runAggregate(this.#context, spec)
		if (this.#groupBy.length > 0) {
			return rows as any
		}
		return rows[0] as any
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

	describe('.required() modifier', () => {
		const UserSchema = Schema.from('users')
			.pk('id', v.string(), () => `u-${Math.random().toString(36).slice(2, 8)}`)
			.field('email', v.string())
			.field('name', v.string())
			.build()

		let repo: any
		beforeEach(() => {
			const adapter = InMemoryAdapter.create({})
			repo = Repo.from(adapter).resolve((s) => ({ table: s.name })).build()
		})

		describe('type narrowing', () => {
			type IsExact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
			type TestA = { findOne: (...a: any[]) => any; createOne: (...a: any[]) => any; createMany: (...a: any[]) => any; updateMany: (...a: any[]) => any; deleteMany: (...a: any[]) => any; upsertOne: (...a: any[]) => any; findMany: (...a: any[]) => any; deleteOne: (...a: any[]) => any; updateOne: (...a: any[]) => any }
			type S = typeof UserSchema
			type Result = import('./internals/types').SelectedWithPreloads<S, never, []>
			type NameOnly = import('./internals/types').SelectedWithPreloads<S, 'name', []>

			test('find() returns T | null without .required()', () => {
				type R = ReturnType<OneBuilderSurface<S, TestA, never, [], false>['find']>
				const _: IsExact<R, Promise<Result | null>> = true
				void _
			})

			test('find() returns T with .required()', () => {
				type R = ReturnType<OneBuilderSurface<S, TestA, never, [], true>['find']>
				const _: IsExact<R, Promise<Result>> = true
				void _
			})

			test('update() returns T with .required()', () => {
				type R = ReturnType<OneBuilderSurface<S, TestA, never, [], true>['update']>
				const _: IsExact<R, Promise<Result>> = true
				void _
			})

			test('delete() returns T with .required()', () => {
				type R = ReturnType<OneBuilderSurface<S, TestA, never, [], true>['delete']>
				const _: IsExact<R, Promise<Result>> = true
				void _
			})

			test('create() return type unchanged regardless of Req', () => {
				type WithReq = ReturnType<OneBuilderSurface<S, TestA, never, [], true>['create']>
				type WithoutReq = ReturnType<OneBuilderSurface<S, TestA, never, [], false>['create']>
				const _: IsExact<WithReq, WithoutReq> = true
				void _
			})

			test('.required() preserves Req through select()', () => {
				type R = ReturnType<OneBuilderSurface<S, TestA, 'name', [], true>['find']>
				const _: IsExact<R, Promise<NameOnly>> = true
				void _
			})

			test('.required() once-per-step: Req=true surface has uncallable required()', () => {
				type ReqBuilder = OneBuilderSurface<S, TestA, never, [], true>
				type RequiredMethod = ReqBuilder['required']
				type ThisParam = ThisParameterType<RequiredMethod>
				type _check = ThisParam extends OneBuilder<S, TestA, never, [], false> ? true : false
				const _: _check = true
				void _
			})
		})

		describe('runtime throw behaviour', () => {
			test('.required().find() throws OrmNotFoundError when no row matched', async () => {
				await expect(
					repo.on(UserSchema).one().required().id('nonexistent').find(),
				).rejects.toThrow(OrmNotFoundError)
			})

			test('.required().update() throws OrmNotFoundError when no row matched', async () => {
				await expect(
					repo.on(UserSchema).one().required().id('nonexistent').update({ name: 'X' }),
				).rejects.toThrow(OrmNotFoundError)
			})

			test('.required().delete() throws OrmNotFoundError when no row matched', async () => {
				await expect(
					repo.on(UserSchema).one().required().id('nonexistent').delete(),
				).rejects.toThrow(OrmNotFoundError)
			})

			test('thrown error carries schema, operation, and where', async () => {
				try {
					await repo.on(UserSchema).one().required().id('u-abc').find()
					expect.unreachable('should have thrown')
				} catch (e) {
					expect(e).toBeInstanceOf(OrmNotFoundError)
					const err = e as InstanceType<typeof OrmNotFoundError>
					expect(err.schema).toBe('users')
					expect(err.operation).toBe('findOne')
					expect(err.where).toBeInstanceOf(FilterGroup)
				}
			})

			test('update throws with operation updateOne', async () => {
				try {
					await repo.on(UserSchema).one().required().id('u-abc').update({ name: 'X' })
					expect.unreachable('should have thrown')
				} catch (e) {
					expect((e as any).operation).toBe('updateOne')
				}
			})

			test('delete throws with operation deleteOne', async () => {
				try {
					await repo.on(UserSchema).one().required().id('u-abc').delete()
					expect.unreachable('should have thrown')
				} catch (e) {
					expect((e as any).operation).toBe('deleteOne')
				}
			})
		})

		describe('no throw when row exists', () => {
			test('.required().find() returns the row when found', async () => {
				const created = await repo.on(UserSchema).one().create({ email: 'a@b.com', name: 'A' })
				const found = await repo.on(UserSchema).one().required().id(created.id).find()
				expect(found.name).toBe('A')
			})

			test('.required().update() returns the updated row', async () => {
				const created = await repo.on(UserSchema).one().create({ email: 'a@b.com', name: 'A' })
				const updated = await repo.on(UserSchema).one().required().id(created.id).update({ name: 'B' })
				expect(updated.name).toBe('B')
			})

			test('.required().delete() returns the deleted row', async () => {
				const created = await repo.on(UserSchema).one().create({ email: 'a@b.com', name: 'A' })
				const deleted = await repo.on(UserSchema).one().required().id(created.id).delete()
				expect(deleted.name).toBe('A')
			})
		})

		describe('custom message', () => {
			test('.required(message) uses custom message on throw', async () => {
				try {
					await repo.on(UserSchema).one().required('user must exist').id('u-abc').find()
					expect.unreachable('should have thrown')
				} catch (e) {
					expect((e as any).message).toBe('user must exist')
				}
			})

			test('default message for PK-keyed chain', async () => {
				try {
					await repo.on(UserSchema).one().required().id('u-abc').find()
					expect.unreachable('should have thrown')
				} catch (e) {
					expect((e as any).message).toBe('users.findOne: no row matched id=u-abc')
				}
			})
		})

		describe('default behaviour preserved', () => {
			test('find() returns null without .required()', async () => {
				const result = await repo.on(UserSchema).one().id('nonexistent').find()
				expect(result).toBeNull()
			})

			test('update() returns null without .required()', async () => {
				const result = await repo.on(UserSchema).one().id('nonexistent').update({ name: 'X' })
				expect(result).toBeNull()
			})

			test('delete() returns null without .required()', async () => {
				const result = await repo.on(UserSchema).one().id('nonexistent').delete()
				expect(result).toBeNull()
			})
		})

		describe('runtime no-op for create/upsert', () => {
			test('.required() before create() returns the created row', async () => {
				const created = await repo.on(UserSchema).one().required().create({ email: 'x@y.com', name: 'X' })
				expect(created.email).toBe('x@y.com')
				expect(created.name).toBe('X')
			})

			test('.required() before upsert() returns the upserted row', async () => {
				const upserted = await repo
					.on(UserSchema)
					.one()
					.required()
					.where((q: any) => q.eq('email', 'x@y.com'))
					.upsert({ create: { email: 'x@y.com', name: 'X' } })
				expect(upserted.email).toBe('x@y.com')
				expect(upserted.name).toBe('X')
			})
		})
	})
}
