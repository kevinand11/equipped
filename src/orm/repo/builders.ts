import type { OrmUse } from '../adapters/base'
import type { AnyField } from '../fields'
import { FilterGroup, type FilterFactory } from '../filter'
import { OrderBy } from '../query'
import type { AnyPreloadDef } from '../relations'
import type { AnySchema, SchemaOutput } from '../schema'
import type { SchemaInsertInput, SchemaUpdateInput } from '../schema-validations'
import { applyComputedSelection, planSelection } from './internals/computeds'
import {
	runAllDelete,
	runAllInsert,
	runAllRead,
	runAllUpdate,
	runOneDelete,
	runOneInsert,
	runOneRead,
	runOneUpdate,
	runOneUpsert,
} from './internals/executors'
import { resolvePreloads } from './internals/preloads'
import type { SelectedWithPreloads } from './internals/types'

type SchemaPrimaryKeyValue<S extends AnySchema> = SchemaOutput<S>[S['pkField']['name'] & keyof SchemaOutput<S>]
type UpsertInput<S extends AnySchema> = { insert: SchemaInsertInput<S> } | { insert: SchemaInsertInput<S>; update: SchemaUpdateInput<S> }
type ReadState<Sel extends string, P extends readonly AnyPreloadDef[] = readonly AnyPreloadDef[]> = {
	where?: FilterGroup
	select?: readonly Sel[]
	preloads?: P
}

type ReadBuilderFor<TBuilder, S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]> = TBuilder extends {
	_builderKind: 'one'
}
	? OneBuilder<S, Sel, P>
	: TBuilder extends { _builderKind: 'all' }
		? AllBuilder<S, Sel, P>
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

abstract class ReadSelectState<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]> {
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
		const nextGroup = this._where.clone()
		factory(nextGroup)
		return this._clone<Sel, P>({
			where: nextGroup,
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
			where: next.where ?? this._where.clone(),
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
	declare readonly _builderKind: 'one'

	id(value: SchemaPrimaryKeyValue<S>): this {
		const nextGroup = this._where.clone()
		nextGroup.eq(this._context.schema.pkField, value)
		return this._clone<Sel, P>({
			where: nextGroup,
			select: this._select as readonly Sel[] | undefined,
			preloads: this._preloads,
		}) as this
	}

	protected _clone<NewSel extends string, NewP extends readonly AnyPreloadDef[]>(next: ReadState<NewSel, NewP>) {
		return new OneBuilder<S, NewSel, NewP>(
			this._context,
			this._readState({
				where: next.where,
				select: next.select,
				preloads: next.preloads,
			}),
		) as any
	}

	insert(data: SchemaInsertInput<S>) {
		return runOneInsert(
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

export class AllBuilder<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]> extends ReadSelectState<S, Sel, P> {
	declare readonly _builderKind: 'all'

	#orderBy: OrderBy[] = []
	#limit: number | undefined
	#offset: number | undefined

	protected _clone<NewSel extends string, NewP extends readonly AnyPreloadDef[]>(next: ReadState<NewSel, NewP>) {
		const cloned = new AllBuilder<S, NewSel, NewP>(
			this._context,
			this._readState({
				where: next.where,
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
			where: this._where.clone(),
			select: this._select as readonly Sel[] | undefined,
			preloads: this._preloads,
		}) as AllBuilder<S, Sel, P>
		cloned.#orderBy = this.#orderBy.concat(new OrderBy(field, direction))
		return cloned as this
	}

	limit(limit: number) {
		const cloned = this._clone<Sel, P>({
			where: this._where.clone(),
			select: this._select as readonly Sel[] | undefined,
			preloads: this._preloads,
		}) as AllBuilder<S, Sel, P>
		cloned.#limit = limit
		return cloned as this
	}

	offset(offset: number) {
		const cloned = this._clone<Sel, P>({
			where: this._where.clone(),
			select: this._select as readonly Sel[] | undefined,
			preloads: this._preloads,
		}) as AllBuilder<S, Sel, P>
		cloned.#offset = offset
		return cloned as this
	}

	insert(data: SchemaInsertInput<S>[]) {
		return runAllInsert(
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
	const { createInMemoryAdapter } = await import('../adapters/in-memory')
	const { defineRepo } = await import('./repo')
	const { defineSchema } = await import('../schema')

	describe('builders', () => {
		let repo: any
		beforeEach(() => {
			const { adapter } = createInMemoryAdapter()
			repo = defineRepo((r) => r.adapter(adapter).resolve((s) => ({ prefix: s.name })))
		})

		test('update() executes and returns updated row', async () => {
			const UserSchema = defineSchema('users', (s) =>
				s.pk('id', v.string(), () => `u-${Math.random().toString(36).slice(2, 8)}`)
				 .field('email', v.string())
				 .field('name', v.string()),
			)

			const created = await repo.from(UserSchema).one().insert({ email: 'up@test.com', name: 'Before' })
			const updated = await repo.from(UserSchema).one().id(created.id).update({ name: 'After' })
			expect(updated?.name).toBe('After')
			const found = await repo.from(UserSchema).one().id(created.id).find()
			expect(found?.name).toBe('After')
		})

		test('find() returns rows', async () => {
			const UserSchema = defineSchema('users', (s) =>
				s.pk('id', v.string(), () => `u-${Math.random().toString(36).slice(2, 8)}`)
				 .field('email', v.string())
				 .field('name', v.string()),
			)

			await repo
				.from(UserSchema)
				.all()
				.insert([
					{ email: 'a@x.com', name: 'Alice' },
					{ email: 'b@x.com', name: 'Bob' },
				])

			const rows = await repo
				.from(UserSchema)
				.all()
				.where((q) => q.or([(g) => g.eq('name', 'Alice'), (g) => g.eq('name', 'Bob')]))
				.find()
			expect(rows).toHaveLength(2)
		})

		test('write branches do not leak filters', async () => {
			const UserSchema = defineSchema('users', (s) =>
				s.pk('id', v.string(), () => `u-${Math.random().toString(36).slice(2, 8)}`)
				 .field('email', v.string())
				 .field('name', v.string()),
			)

			await repo
				.from(UserSchema)
				.all()
				.insert([
					{ email: 'alice@x.com', name: 'Alice' },
					{ email: 'bob@x.com', name: 'Bob' },
				])

			const base = repo.from(UserSchema).all()
			await base.where((q) => q.eq('name', 'Alice')).update({ name: 'A Updated' })
			await base.where((q) => q.eq('name', 'Bob')).update({ name: 'B Updated' })

			const all = await repo.from(UserSchema).all().orderBy('name', 'asc').find()
			expect(all.map((r) => r.name)).toEqual(['A Updated', 'B Updated'])
		})
	})
}
