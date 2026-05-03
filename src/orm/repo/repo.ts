import type { InferAdapterConfig, InferAdapterQueryableOps, SchemaCompatible } from '../adapter'
import type { OrmAdapterLike } from '../adapters/base'
import { assertNormalisedFilter, FilterGroup, type FilterFactory, type GatedFilterFactory } from '../filter'
import type { AnySchema, SchemaOutput, SchemaPersistedOutput } from '../schema'
import { validateInsert, validateInsertMany, validateUpdate, validateUpdateOps, type SchemaInsertInput, type SchemaUpdateInput } from '../schema-validations'
import type { AnyUpdateOp, UpdateOp } from '../updates'
import { SchemaContext, SchemaRef } from './builders'

export type ConfigTransform<C> = (config: C, schema: AnySchema) => C
export type ContextSource<C> = { get: () => ConfigTransform<C> | null }

export class Repo<A extends OrmAdapterLike<any>> {
	readonly #adapter: A
	readonly #defaults: (schema: AnySchema) => InferAdapterConfig<A>
	readonly #contextSource?: ContextSource<InferAdapterConfig<A>>
	readonly #resolverStack: ConfigTransform<InferAdapterConfig<A>>[] = []

	constructor({ adapter, resolve, context }: {
		adapter: A
		resolve: (schema: AnySchema) => InferAdapterConfig<A>
		context?: ContextSource<InferAdapterConfig<A>>
	}) {
		this.#adapter = adapter
		this.#defaults = resolve
		this.#contextSource = context
	}

	#getConfig(s: AnySchema): InferAdapterConfig<A> {
		let config = this.#defaults(s)
		if (this.#contextSource) {
			const transform = this.#contextSource.get()
			if (transform) config = transform(config, s)
		}
		for (const resolver of this.#resolverStack) {
			config = resolver(config, s)
		}
		return config
	}

	#getUse(s: AnySchema) {
		return this.#adapter.use(s, this.#getConfig(s))
	}

	from<S extends AnySchema>(schema: S): SchemaRef<S> {
		return new SchemaRef<S>(new SchemaContext(schema, (target) => this.#getUse(target)))
	}

	async findByPk<S extends AnySchema>(schema: SchemaCompatible<A, S>, pk: unknown): Promise<SchemaPersistedOutput<S> | null> {
		const s = schema as unknown as AnySchema
		const config = this.#getConfig(s)
		const adapter = this.#adapter as any
		if (adapter.crud?.findByPk) {
			const result = await adapter.crud.findByPk(s, config, pk)
			return (result as SchemaPersistedOutput<S>) ?? null
		}
		throw new Error('Adapter does not implement crud.findByPk')
	}

	async findMany<S extends AnySchema>(
		schema: SchemaCompatible<A, S>,
		q: GatedFilterFactory<InferAdapterQueryableOps<A>>,
	): Promise<SchemaPersistedOutput<S>[]> {
		const s = schema as unknown as AnySchema
		const group = (q as unknown as FilterFactory)(FilterGroup.create())
		assertNormalisedFilter(s, group)
		const use = this.#getUse(s)
		return (await use.findMany(group)) as SchemaPersistedOutput<S>[]
	}

	async findOne<S extends AnySchema>(
		schema: SchemaCompatible<A, S>,
		q: GatedFilterFactory<InferAdapterQueryableOps<A>>,
	): Promise<SchemaPersistedOutput<S> | null> {
		const s = schema as unknown as AnySchema
		const group = (q as unknown as FilterFactory)(FilterGroup.create())
		assertNormalisedFilter(s, group)
		const use = this.#getUse(s)
		return (await use.findOne(group)) as SchemaPersistedOutput<S> | null
	}

	async updateByPk<S extends AnySchema>(
		schema: SchemaCompatible<A, S>,
		pk: unknown,
		op0: UpdateOp<S, A>,
		...rest: UpdateOp<S, A>[]
	): Promise<SchemaPersistedOutput<S> | null> {
		const s = schema as unknown as AnySchema
		const config = this.#getConfig(s)
		const adapter = this.#adapter as any
		if (!adapter.crud?.updateByPk) {
			throw new Error('Adapter does not implement crud.updateByPk')
		}
		const ops = [op0, ...rest] as AnyUpdateOp[]
		const normalised = validateUpdateOps(s, ops)
		const result = await adapter.crud.updateByPk(s, config, pk, normalised)
		return (result as SchemaPersistedOutput<S>) ?? null
	}

	async deleteByPk<S extends AnySchema>(
		schema: SchemaCompatible<A, S>,
		pk: unknown,
	): Promise<SchemaPersistedOutput<S> | null> {
		const s = schema as unknown as AnySchema
		const config = this.#getConfig(s)
		const adapter = this.#adapter as any
		if (adapter.crud?.deleteByPk) {
			const result = await adapter.crud.deleteByPk(s, config, pk)
			return (result as SchemaPersistedOutput<S>) ?? null
		}
		throw new Error('Adapter does not implement crud.deleteByPk')
	}

	async raw<T = unknown>(schema: AnySchema, command: unknown, params?: unknown[]): Promise<T> {
		const config = this.#getConfig(schema)
		const adapter = this.#adapter as any
		if (adapter.crud?.raw) {
			return adapter.crud.raw(schema, config, command, params)
		}
		throw new Error('Adapter does not implement crud.raw')
	}

	async updateOne<S extends AnySchema>(
		schema: SchemaCompatible<A, S>,
		filter: GatedFilterFactory<InferAdapterQueryableOps<A>>,
		data: SchemaUpdateInput<S>,
	): Promise<SchemaPersistedOutput<S> | null> {
		const s = schema as unknown as AnySchema
		const validated = validateUpdate(s, data as any)
		const group = (filter as unknown as FilterFactory)(FilterGroup.create())
		assertNormalisedFilter(s, group)
		const use = this.#getUse(s)
		const match = await use.findOne(group)
		if (!match) return null
		const pkQ = FilterGroup.create().eq(s.pkField.name, match[s.pkField.name])
		const rows = await use.updateMany(pkQ, validated as any)
		return (rows[0] as SchemaPersistedOutput<S>) ?? null
	}

	async updateMany<S extends AnySchema>(
		schema: SchemaCompatible<A, S>,
		filter: GatedFilterFactory<InferAdapterQueryableOps<A>>,
		data: SchemaUpdateInput<S>,
	): Promise<SchemaPersistedOutput<S>[]> {
		const s = schema as unknown as AnySchema
		const validated = validateUpdate(s, data as any)
		const group = (filter as unknown as FilterFactory)(FilterGroup.create())
		assertNormalisedFilter(s, group)
		const rows = await this.#getUse(s).updateMany(group, validated as any)
		return rows as SchemaPersistedOutput<S>[]
	}

	async deleteOne<S extends AnySchema>(
		schema: SchemaCompatible<A, S>,
		filter: GatedFilterFactory<InferAdapterQueryableOps<A>>,
	): Promise<SchemaPersistedOutput<S> | null> {
		const s = schema as unknown as AnySchema
		const group = (filter as unknown as FilterFactory)(FilterGroup.create())
		assertNormalisedFilter(s, group)
		const row = await this.#getUse(s).deleteOne(group)
		return (row as SchemaPersistedOutput<S>) ?? null
	}

	async deleteMany<S extends AnySchema>(
		schema: SchemaCompatible<A, S>,
		filter: GatedFilterFactory<InferAdapterQueryableOps<A>>,
	): Promise<SchemaPersistedOutput<S>[]> {
		const s = schema as unknown as AnySchema
		const group = (filter as unknown as FilterFactory)(FilterGroup.create())
		assertNormalisedFilter(s, group)
		const rows = await this.#getUse(s).deleteMany(group)
		return rows as SchemaPersistedOutput<S>[]
	}

	async session<T>(fn: () => Promise<T>): Promise<T> {
		return this.#adapter.session(fn)
	}

	async insertOne<S extends AnySchema>(schema: S, data: SchemaInsertInput<S>): Promise<SchemaOutput<S>> {
		const validated = validateInsert(schema, data as Record<string, unknown>)
		const use = this.#getUse(schema)
		const row = await use.insertOne(validated as Record<string, unknown>)
		return row as SchemaOutput<S>
	}

	async insertMany<S extends AnySchema>(schema: S, data: SchemaInsertInput<S>[]): Promise<SchemaOutput<S>[]> {
		const validated = validateInsertMany(schema, data as Record<string, unknown>[])
		const use = this.#getUse(schema)
		const rows = await use.insertMany(validated as Record<string, unknown>[])
		return rows as SchemaOutput<S>[]
	}

	async resolve<T>(
		resolver: (config: InferAdapterConfig<A>, schema: AnySchema) => InferAdapterConfig<A>,
		fn: () => Promise<T>,
	): Promise<T> {
		this.#resolverStack.push(resolver)
		try {
			return await fn()
		} finally {
			this.#resolverStack.pop()
		}
	}
}

class RepoBuilder<A = never, Config = never> {
	#adapter: unknown
	#resolve: unknown
	#context: unknown

	adapter<NewA>(a: [A] extends [never] ? NewA : never): RepoBuilder<NewA, Config> {
		this.#adapter = a
		return this as unknown as RepoBuilder<NewA, Config>
	}

	resolve<NewConfig>(fn: [Config] extends [never] ? (schema: AnySchema) => NewConfig : never): RepoBuilder<A, NewConfig> {
		this.#resolve = fn
		return this as unknown as RepoBuilder<A, NewConfig>
	}

	context(source: ContextSource<Config>): RepoBuilder<A, Config> {
		this.#context = source
		return this
	}

	_build() {
		return { adapter: this.#adapter, resolve: this.#resolve, context: this.#context }
	}
}

type HasMethod<A, Bag extends string, Method extends string> = A extends Record<Bag, Record<Method, (...args: any) => any>>
	? true
	: false

export type RepoSurface<A extends OrmAdapterLike<any>> = Repo<A> &
	(HasMethod<A, 'queryable', 'updateMany'> extends true ? {} : { updateOne: never; updateMany: never }) &
	(HasMethod<A, 'queryable', 'deleteMany'> extends true ? {} : { deleteOne: never; deleteMany: never }) &
	(HasMethod<A, 'crud', 'updateByPk'> extends true ? {} : { updateByPk: never }) &
	(HasMethod<A, 'crud', 'deleteByPk'> extends true ? {} : { deleteByPk: never }) &
	(HasMethod<A, 'crud', 'raw'> extends true ? {} : { raw: never }) &
	(HasMethod<A, 'transactional', 'session'> extends true ? {} : { session: never })

export function defineRepo<A extends OrmAdapterLike<any>, Config>(
	build: (b: RepoBuilder) => RepoBuilder<A, Config>,
): RepoSurface<A> {
	const data = build(new RepoBuilder())._build()
	return new Repo<A>({ adapter: data.adapter as A, resolve: data.resolve as any, context: data.context as any }) as RepoSurface<A>
}

if (import.meta.vitest) {
	const { describe, test, expect, expectTypeOf, vi } = import.meta.vitest
	const { v } = await import('valleyed')
	const { createInMemoryAdapter } = await import('../adapters/in-memory')
	const { defineAdapter } = await import('../adapter')
	const { defineRelations } = await import('../relations')
	const { defineSchema } = await import('../schema')

	describe('repo/Repo core behavior', () => {
		let userCounter = 0
		let postCounter = 0
		let profileCounter = 0
		let orgCounter = 0

		const UserSchema = defineSchema('users', (s) =>
			s
				.pk('id', v.string(), () => `u${++userCounter}`)
				.field('email', v.string())
				.field('name', v.string())
				.field('orgId', v.optional(v.string()), { onCreate: () => undefined })
				.field('createdAt', v.number(), { onCreate: () => 1000 }),
		)

		const PostSchema = defineSchema('posts', (s) =>
			s
				.pk('id', v.string(), () => `p${++postCounter}`)
				.field('title', v.string())
				.field('userId', v.string()),
		)

		const ProfileSchema = defineSchema('profiles', (s) =>
			s
				.pk('id', v.string(), () => `pr${++profileCounter}`)
				.field('bio', v.string())
				.field('userId', v.string()),
		)

		const OrgSchema = defineSchema('orgs', (s) => s.pk('id', v.string(), () => `o${++orgCounter}`).field('name', v.string()))

		const PersonSchema = defineSchema('people', (s) =>
			s
				.pk('id', v.string(), () => `person-${++userCounter}`)
				.field('firstName', v.string())
				.field('lastName', v.string())
				.computed('fullName', ['firstName', 'lastName'], v.string(), ({ firstName, lastName }) => `${firstName} ${lastName}`),
		)

		const UserRels = defineRelations(UserSchema, (rel, src) =>
			rel
				.hasMany('posts', PostSchema.fields.userId)
				.hasOne('profile', ProfileSchema.fields.userId)
				.belongsTo('org', src.fields.orgId, OrgSchema),
		)

		function makeRepo() {
			const { adapter } = createInMemoryAdapter()
			return defineRepo((r) => r.adapter(adapter).resolve((s) => ({ prefix: s.name })))
		}

		test('fluent builders support one/all read chains', async () => {
			const repo = makeRepo()
			const created = await repo.from(UserSchema).one().insert({ email: 'fluent@test.com', name: 'Fluent User' })

			const one = await repo.from(UserSchema).one().id(created.id).select(['id', 'name']).find()
			expect(one).toEqual({ id: created.id, name: 'Fluent User' })

			const all = await repo
				.from(UserSchema)
				.all()
				.where((q) => q.eq('id', created.id))
				.orderBy('createdAt', 'desc')
				.limit(1)
				.select(['id'])
				.find()

			expect(all).toEqual([{ id: created.id }])
		})

		test('builder snapshots are immutable across chain branches', async () => {
			const repo = makeRepo()
			await repo
				.from(UserSchema)
				.all()
				.insert([
					{ email: 'alice@branch.com', name: 'Alice' },
					{ email: 'bob@branch.com', name: 'Bob' },
				])

			const base = repo.from(UserSchema).all()
			const branchA = base.where((q) => q.eq('name', 'Alice')).select(['id'])
			const branchB = base.where((q) => q.eq('name', 'Bob')).select(['name'])

			const rowsA = await branchA.find()
			const rowsB = await branchB.find()

			expect(rowsA).toHaveLength(1)
			expect(rowsB).toHaveLength(1)
			expect(rowsA.every((r) => 'id' in r && !('name' in r))).toBe(true)
			expect(rowsB).toEqual([{ name: 'Bob' }])
		})

		test('fluent builders support write chains with preloads', async () => {
			const repo = makeRepo()
			const org = await repo.from(OrgSchema).one().insert({ name: 'Fluent Org' })

			const user = await repo
				.from(UserSchema)
				.one()
				.preload([UserRels.org])
				.insert({ email: 'writer@test.com', name: 'Writer', orgId: org.id })

			expect((user.org as any).name).toBe('Fluent Org')

			const updated = await repo.from(UserSchema).one().id(user.id).select(['id', 'name']).update({ name: 'Updated Writer' })

			expect(updated).toEqual({ id: user.id, name: 'Updated Writer' })

			const deleted = await repo.from(UserSchema).one().id(user.id).select(['id']).delete()
			expect(deleted).toEqual({ id: user.id })
		})

		test('session supports multi-operation writes with fluent builders', async () => {
			const repo = makeRepo()

			const insertedId = await repo.session(async () => {
				const created = await repo.from(UserSchema).one().insert({ email: 'tx@fluent.com', name: 'Tx Fluent' })
				await repo.from(UserSchema).one().id(created.id).update({ name: 'Tx Fluent Updated' })
				return created.id
			})

			const persisted = await repo.from(UserSchema).one().id(insertedId).select(['name']).find()
			expect(persisted).toEqual({ name: 'Tx Fluent Updated' })
		})

		test('insert/find/update/delete flows work', async () => {
			const repo = makeRepo()
			const user = await repo.from(UserSchema).one().insert({ email: 'a@b.com', name: 'Alice' })
			expect(user.id).toMatch(/^u\d+$/)
			expect(user.createdAt).toBe(1000)

			const found = await repo.from(UserSchema).one().id(user.id).find()
			expect(found?.id).toBe(user.id)

			const updated = await repo.from(UserSchema).one().id(user.id).update({ name: 'Updated' })
			expect(updated?.name).toBe('Updated')

			const deleted = await repo.from(UserSchema).one().id(user.id).delete()
			expect(deleted?.id).toBe(user.id)
		})

		test('findById, updateById, and deleteById target the schema primary key', async () => {
			const repo = makeRepo()
			const user = await repo.from(UserSchema).one().insert({ email: 'id@test.com', name: 'ById' })

			const found = await repo.from(UserSchema).one().id(user.id).find()
			expect(found?.id).toBe(user.id)

			const updated = await repo.from(UserSchema).one().id(user.id).update({ name: 'Changed' })
			expect(updated?.name).toBe('Changed')

			const deleted = await repo.from(UserSchema).one().id(user.id).delete()
			expect(deleted?.id).toBe(user.id)
			expect(await repo.from(UserSchema).one().id(user.id).find()).toBeNull()
		})

		test('insertMany, findMany and upsertOne work', async () => {
			const repo = makeRepo()
			await repo
				.from(UserSchema)
				.all()
				.insert([
					{ email: 'a@b.com', name: 'Alice' },
					{ email: 'b@c.com', name: 'Bob' },
				])
			expect(await repo.from(UserSchema).all().find()).toHaveLength(2)

			const inserted = await repo
				.from(UserSchema)
				.one()
				.where((q) => q.eq('id', 'u-fixed'))
				.upsert({ insert: { email: 'new@test.com', name: 'New' } })
			expect(inserted.name).toBe('New')
		})

		test('accepts chainable where input for filters and options', async () => {
			const repo = makeRepo()
			await repo
				.from(UserSchema)
				.all()
				.insert([
					{ email: 'a@b.com', name: 'Alice' },
					{ email: 'b@c.com', name: 'Bob' },
				])

			const rows = await repo
				.from(UserSchema)
				.all()
				.where((q) => q.or([(g) => g.eq('name', 'Alice'), (g) => g.eq('name', 'Bob')]))
				.orderBy('name', 'desc')
				.limit(1)
				.find()

			expect(rows).toHaveLength(1)
			expect(rows[0].name).toBe('Bob')
		})

		test('resolve chains adapter config transforms', async () => {
			const seenConfigs: unknown[] = []
			const { adapter } = createInMemoryAdapter()
			const origUse = adapter.use.bind(adapter)
			;(adapter as any).use = vi.fn((s: any, config: any) => {
				seenConfigs.push(config)
				return origUse(s, config)
			})

			const repo = defineRepo((r) => r.adapter(adapter).resolve((s) => ({ prefix: s.name })))

			await repo.resolve(
				(config) => ({ prefix: `a_${(config as any).prefix}` }),
				async () => {
					await repo.resolve(
						(config) => ({ prefix: `b_${(config as any).prefix}` }),
						async () => {
							await repo.from(UserSchema).all().find()
						},
					)
				},
			)

			expect(seenConfigs[0]).toEqual({ prefix: 'b_a_users' })
		})

		test('session returns callback value and persists writes', async () => {
			const repo = makeRepo()
			let insertedId = ''
			const result = await repo.session(async () => {
				const inserted = await repo.from(UserSchema).one().insert({ email: 't@test.com', name: 'TxUser' })
				insertedId = inserted.id
				return 42
			})

			expect(result).toBe(42)
			expect(await repo.from(UserSchema).one().id(insertedId).find()).not.toBeNull()
		})

		test('preloads can be resolved on mutation methods', async () => {
			const repo = makeRepo()
			const org = await repo.from(OrgSchema).one().insert({ name: 'Corp' })
			const user = await repo
				.from(UserSchema)
				.one()
				.preload([UserRels.org])
				.insert({ email: 'u@test.com', name: 'User', orgId: org.id })
			expect((user.org as any).name).toBe('Corp')

			await repo.from(PostSchema).one().insert({ title: 'Post', userId: user.id })
			const updated = await repo.from(UserSchema).one().id(user.id).preload([UserRels.posts]).update({ name: 'Updated' })
			expect(updated?.posts).toHaveLength(1)
		})

		test('raw operations throw EquippedError on in-memory adapter', async () => {
			const { EquippedError } = await import('../../errors')
			const repo = makeRepo()
			const error = await repo
				.from(UserSchema)
				.raw('SELECT * FROM users')
				.catch((e) => e)
			expect(error).toBeInstanceOf(EquippedError)
		})

		test('computed fields are derived and shaped correctly when selected', async () => {
			const repo = makeRepo()
			const created = await repo.from(PersonSchema).one().insert({ firstName: 'Ada', lastName: 'Lovelace' })
			const rows = await repo.from(PersonSchema).all().select(['id', 'fullName']).find()

			expect(rows).toEqual([{ id: created.id, fullName: 'Ada Lovelace' }])
		})

		test('computed field selection auto-includes dependencies for adapter reads', async () => {
			const { adapter } = createInMemoryAdapter()
			const origUse = adapter.use.bind(adapter)
			let seenSelect: string[] | undefined
			;(adapter as any).use = vi.fn((schema: any, config: any) => {
				const use = origUse(schema, config)
				return {
					...use,
					findMany: async (filter: any, options: any) => {
						seenSelect = options?.select as string[] | undefined
						return use.findMany(filter, options)
					},
				}
			})

			const repo = defineRepo((r) => r.adapter(adapter).resolve((s) => ({ prefix: s.name })))
			await repo.from(PersonSchema).one().insert({ firstName: 'Grace', lastName: 'Hopper' })
			await repo.from(PersonSchema).all().select(['id', 'fullName']).find()

			expect(seenSelect).toEqual(expect.arrayContaining(['id', 'firstName', 'lastName']))
		})

		test('unknown selected fields fail fast', async () => {
			const { EquippedError } = await import('../../errors')
			const repo = makeRepo()
			await repo.from(PersonSchema).one().insert({ firstName: 'Ada', lastName: 'Lovelace' })

			await expect(
				repo
					.from(PersonSchema)
					.all()
					.select(['unknownField' as any])
					.find(),
			).rejects.toBeInstanceOf(EquippedError)
		})

		test('missing computed dependencies in adapter output fail fast', async () => {
			const { EquippedError } = await import('../../errors')
			const { adapter } = createInMemoryAdapter()
			const origUse = adapter.use.bind(adapter)
			;(adapter as any).use = vi.fn((schema: any, config: any) => {
				const use = origUse(schema, config)
				return {
					...use,
					findMany: async (filter: any, options: any) => {
						const rows = await use.findMany(filter, options)
						return rows.map((row: any) => {
							const next = { ...row }
							delete (next as any).lastName
							return next
						})
					},
				}
			})

			const repo = defineRepo((r) => r.adapter(adapter).resolve((s) => ({ prefix: s.name })))
			await repo.from(PersonSchema).one().insert({ firstName: 'Katherine', lastName: 'Johnson' })

			await expect(repo.from(PersonSchema).all().select(['fullName']).find()).rejects.toBeInstanceOf(EquippedError)
		})

		test('repo.findByPk returns seeded document and null for missing', async () => {
			const TestSchema = defineSchema('findbytest', (s) => s.pk('id', v.string(), () => 'gen'))
			const { adapter } = createInMemoryAdapter()
			const repo = defineRepo((r) => r.adapter(adapter).resolve((s) => ({ prefix: s.name })))

			const use = adapter.use(TestSchema, { prefix: 'findbytest' })
			await use.insertOne({ id: 'x' })

			const found = await repo.findByPk(TestSchema, 'x')
			expect(found).toEqual({ id: 'x' })

			const missing = await repo.findByPk(TestSchema, 'missing')
			expect(missing).toBeNull()
		})

		describe('schema-per-call insert path', () => {
			test('insertOne round-trip via findByPk', async () => {
				const repo = makeRepo()
				const inserted = await repo.insertOne(UserSchema, { email: 'rt@test.com', name: 'RoundTrip' })
				expect(inserted.email).toBe('rt@test.com')
				expect(inserted.name).toBe('RoundTrip')
				expect(inserted.id).toBeDefined()

				const found = await repo.findByPk(UserSchema, inserted.id)
				expect(found).not.toBeNull()
				expect(found!.id).toBe(inserted.id)
				expect(found!.email).toBe('rt@test.com')
			})

			test('insertOne injects onCreate defaults for missing fields', async () => {
				const repo = makeRepo()
				const inserted = await repo.insertOne(UserSchema, { email: 'defaults@test.com', name: 'Defaults' })
				expect(inserted.createdAt).toBe(1000)
				expect(inserted.id).toBeDefined()
			})

			test('insertOne throws OrmValidationError with kind validation and field populated', async () => {
				const { OrmValidationError } = await import('../schema-validations')
				const repo = makeRepo()
				try {
					await repo.insertOne(UserSchema, { email: 123 as any, name: 'Bad' })
					expect.unreachable()
				} catch (e) {
					expect(e).toBeInstanceOf(OrmValidationError)
					const err = e as InstanceType<typeof OrmValidationError>
					expect(err.kind).toBe('validation')
					expect(err.operation).toBe('insertOne')
					expect(err.schema).toBe('users')
					expect(err.failures.length).toBeGreaterThan(0)
					expect(err.failures[0].field).toBe('email')
				}
			})

			test('insertMany round-trip via findByPk', async () => {
				const repo = makeRepo()
				const inserted = await repo.insertMany(UserSchema, [
					{ email: 'a@test.com', name: 'Alice' },
					{ email: 'b@test.com', name: 'Bob' },
				])
				expect(inserted).toHaveLength(2)

				const foundA = await repo.findByPk(UserSchema, inserted[0].id)
				const foundB = await repo.findByPk(UserSchema, inserted[1].id)
				expect(foundA!.email).toBe('a@test.com')
				expect(foundB!.email).toBe('b@test.com')
			})

			test('insertMany collects all failures with rowIndex and throws single OrmValidationError', async () => {
				const { OrmValidationError } = await import('../schema-validations')
				const repo = makeRepo()
				try {
					await repo.insertMany(UserSchema, [
						{ email: 'good@test.com', name: 'Good' },
						{ email: 123 as any, name: 'Bad' },
						{ email: 'also-bad' as any, name: 456 as any },
					])
					expect.unreachable()
				} catch (e) {
					expect(e).toBeInstanceOf(OrmValidationError)
					const err = e as InstanceType<typeof OrmValidationError>
					expect(err.kind).toBe('validation')
					expect(err.operation).toBe('insertMany')
					expect(err.schema).toBe('users')
					const rowIndices = err.failures.map((f) => f.rowIndex)
					expect(rowIndices).toContain(1)
					expect(rowIndices).toContain(2)
					expect(rowIndices).not.toContain(0)
				}
			})

			test('findByPk returns null for non-existent pk', async () => {
				const repo = makeRepo()
				const result = await repo.findByPk(UserSchema, 'nonexistent')
				expect(result).toBeNull()
			})

			test('insertMany with onCreate defaults applied to all rows', async () => {
				const repo = makeRepo()
				const inserted = await repo.insertMany(UserSchema, [
					{ email: 'x@test.com', name: 'X' },
					{ email: 'y@test.com', name: 'Y' },
				])
				expect(inserted[0].createdAt).toBe(1000)
				expect(inserted[1].createdAt).toBe(1000)
				expect(inserted[0].id).toBeDefined()
				expect(inserted[1].id).toBeDefined()
			})
		})

		test('repo.deleteByPk removes and returns document, null for missing', async () => {
			const repo = makeRepo()
			const user = await repo.from(UserSchema).one().insert({ email: 'del@test.com', name: 'ToDelete' })

			const deleted = await repo.deleteByPk(UserSchema, user.id)
			expect(deleted).toEqual(expect.objectContaining({ id: user.id, name: 'ToDelete' }))

			const found = await repo.findByPk(UserSchema, user.id)
			expect(found).toBeNull()

			const missing = await repo.deleteByPk(UserSchema, 'nonexistent')
			expect(missing).toBeNull()
		})

		test('repo.raw passes through to adapter crud.raw', async () => {
			const { EquippedError } = await import('../../errors')
			const repo = makeRepo()
			await expect(repo.raw(UserSchema, 'SELECT * FROM users')).rejects.toBeInstanceOf(EquippedError)
		})

		test('repo.updateOne updates first matching document via filter', async () => {
			const repo = makeRepo()
			await repo.from(UserSchema).all().insert([
				{ email: 'a@test.com', name: 'Alice' },
				{ email: 'b@test.com', name: 'Bob' },
			])

			const updated = await repo.updateOne(
				UserSchema,
				(q) => q.eq('name', 'Alice'),
				{ name: 'Alicia' },
			)
			expect(updated?.name).toBe('Alicia')
		})

		test('repo.updateOne with non-unique filter selects first match', async () => {
			const repo = makeRepo()
			await repo.from(UserSchema).all().insert([
				{ email: 'a@test.com', name: 'Same' },
				{ email: 'b@test.com', name: 'Same' },
			])

			const updated = await repo.updateOne(
				UserSchema,
				(q) => q.eq('name', 'Same'),
				{ name: 'Changed' },
			)
			expect(updated?.name).toBe('Changed')

			const all = await repo.from(UserSchema).all().find()
			const changedCount = all.filter((u) => u.name === 'Changed').length
			expect(changedCount).toBe(1)
		})

		test('repo.updateMany updates all matching documents', async () => {
			const repo = makeRepo()
			await repo.from(UserSchema).all().insert([
				{ email: 'a@test.com', name: 'Same' },
				{ email: 'b@test.com', name: 'Same' },
				{ email: 'c@test.com', name: 'Different' },
			])

			const updated = await repo.updateMany(
				UserSchema,
				(q) => q.eq('name', 'Same'),
				{ name: 'Updated' },
			)
			expect(updated).toHaveLength(2)
			expect(updated.every((u) => u.name === 'Updated')).toBe(true)
		})

		test('repo.updateMany applies auto-bump for onUpdate fields', async () => {
			const AutoSchema = defineSchema('auto', (s) =>
				s
					.pk('id', v.string(), () => `a${++userCounter}`)
					.field('name', v.string())
					.field('updatedAt', v.number(), { onCreate: () => 0, onUpdate: () => 9999 }),
			)
			const repo = makeRepo()
			await repo.from(AutoSchema).one().insert({ name: 'A' })

			const updated = await repo.updateMany(
				AutoSchema,
				(q) => q.eq('name', 'A'),
				{ name: 'B' },
			)
			expect(updated[0].updatedAt).toBe(9999)
		})

		test('repo.deleteOne removes first matching document', async () => {
			const repo = makeRepo()
			await repo.from(UserSchema).all().insert([
				{ email: 'a@test.com', name: 'Alice' },
				{ email: 'b@test.com', name: 'Bob' },
			])

			const deleted = await repo.deleteOne(UserSchema, (q) => q.eq('name', 'Alice'))
			expect(deleted?.name).toBe('Alice')

			const remaining = await repo.from(UserSchema).all().find()
			expect(remaining).toHaveLength(1)
		})

		test('repo.deleteMany removes all matching and returns them', async () => {
			const repo = makeRepo()
			await repo.from(UserSchema).all().insert([
				{ email: 'a@test.com', name: 'ToDelete' },
				{ email: 'b@test.com', name: 'ToDelete' },
				{ email: 'c@test.com', name: 'Keep' },
			])

			const deleted = await repo.deleteMany(UserSchema, (q) => q.eq('name', 'ToDelete'))
			expect(deleted).toHaveLength(2)

			const remaining = await repo.from(UserSchema).all().find()
			expect(remaining).toHaveLength(1)
			expect(remaining[0].name).toBe('Keep')
		})

		test('round-trip update via filter preserves data integrity', async () => {
			const repo = makeRepo()
			const user = await repo.from(UserSchema).one().insert({ email: 'rt@test.com', name: 'Original' })

			await repo.updateOne(
				UserSchema,
				(q) => q.eq('id', user.id),
				{ name: 'Modified' },
			)

			const found = await repo.findByPk(UserSchema, user.id)
			expect(found?.name).toBe('Modified')
			expect(found?.email).toBe('rt@test.com')
		})
	})

	describe('type-level: defineRepo builder uniqueness', () => {
		test('duplicate .adapter() call is a TS error', () => {
			const { adapter } = createInMemoryAdapter()
			defineRepo((r) =>
				r
					.adapter(adapter)
					// @ts-expect-error — calling adapter() twice should fail
					.adapter(adapter)
					.resolve((s) => ({ prefix: s.name })),
			)
		})

		test('duplicate .resolve() call is a TS error', () => {
			const { adapter } = createInMemoryAdapter()
			const resolve = (s: any) => ({ prefix: s.name })
			// @ts-expect-error — calling resolve() twice should fail
			defineRepo((r) => r.adapter(adapter).resolve(resolve).resolve(resolve))
		})
	})

	describe('type-level: SchemaCompatible on repo.findByPk', () => {
		test('adapter with matching field types accepts schema', () => {
			const _adapter = defineAdapter((a) => a.supportedFieldTypes('string').crud({ findByPk: async () => null }))
			const _TestSchema = defineSchema('test', (s) => s.pk('id', v.string(), () => 'x'))
			const _repo = defineRepo((r) => r.adapter(_adapter).resolve(() => ({})))
			expectTypeOf(_repo.findByPk<typeof _TestSchema>).toBeFunction()
		})
	})

	describe('repo.findMany / repo.findOne end-to-end', () => {
		const TestSchema = defineSchema('e2e', (s) =>
			s
				.pk('id', v.string(), () => `e-${Math.random().toString(36).slice(2)}`)
				.field('name', v.string())
				.field('age', v.number())
				.field('active', v.boolean())
				.field('tags', v.array(v.string()))
				.field('score', v.optional(v.number()), { onCreate: () => undefined }),
		)

		function makeE2eRepo() {
			const { adapter } = createInMemoryAdapter()
			const repo = defineRepo((r) => r.adapter(adapter).resolve((s) => ({ prefix: s.name })))
			return { repo, adapter }
		}

		async function seedData(repo: any) {
			await repo
				.from(TestSchema)
				.all()
				.insert([
					{ name: 'Alice', age: 30, active: true, tags: ['admin', 'user'] },
					{ name: 'Bob', age: 20, active: false, tags: ['user'] },
					{ name: 'Carol', age: 40, active: true, tags: ['admin'] },
					{ name: 'Dave', age: 25, active: true, tags: ['user', 'guest'], score: 100 },
				])
		}

		test('repo.findMany returns matching documents', async () => {
			const { repo } = makeE2eRepo()
			await seedData(repo)
			const results = await repo.findMany(TestSchema, (q) => q.eq(TestSchema.fields.active, true))
			expect(results).toHaveLength(3)
			expect(results.every((r) => r.active === true)).toBe(true)
		})

		test('repo.findOne returns first matching document', async () => {
			const { repo } = makeE2eRepo()
			await seedData(repo)
			const result = await repo.findOne(TestSchema, (q) => q.eq(TestSchema.fields.name, 'Bob'))
			expect(result).not.toBeNull()
			expect(result!.name).toBe('Bob')
		})

		test('repo.findOne returns null when no match', async () => {
			const { repo } = makeE2eRepo()
			await seedData(repo)
			const result = await repo.findOne(TestSchema, (q) => q.eq(TestSchema.fields.name, 'Nobody'))
			expect(result).toBeNull()
		})

		test('eq filter op matches exact value', async () => {
			const { repo } = makeE2eRepo()
			await seedData(repo)
			const results = await repo.findMany(TestSchema, (q) => q.eq(TestSchema.fields.age, 30))
			expect(results).toHaveLength(1)
			expect(results[0].name).toBe('Alice')
		})

		test('ne filter op excludes matching values', async () => {
			const { repo } = makeE2eRepo()
			await seedData(repo)
			const results = await repo.findMany(TestSchema, (q) => q.ne(TestSchema.fields.name, 'Alice'))
			expect(results).toHaveLength(3)
			expect(results.every((r) => r.name !== 'Alice')).toBe(true)
		})

		test('gt filter op matches values greater than', async () => {
			const { repo } = makeE2eRepo()
			await seedData(repo)
			const results = await repo.findMany(TestSchema, (q) => q.gt(TestSchema.fields.age, 25))
			expect(results.map((r) => r.name).sort()).toEqual(['Alice', 'Carol'])
		})

		test('gte filter op matches values greater than or equal', async () => {
			const { repo } = makeE2eRepo()
			await seedData(repo)
			const results = await repo.findMany(TestSchema, (q) => q.gte(TestSchema.fields.age, 30))
			expect(results.map((r) => r.name).sort()).toEqual(['Alice', 'Carol'])
		})

		test('lt filter op matches values less than', async () => {
			const { repo } = makeE2eRepo()
			await seedData(repo)
			const results = await repo.findMany(TestSchema, (q) => q.lt(TestSchema.fields.age, 25))
			expect(results).toHaveLength(1)
			expect(results[0].name).toBe('Bob')
		})

		test('lte filter op matches values less than or equal', async () => {
			const { repo } = makeE2eRepo()
			await seedData(repo)
			const results = await repo.findMany(TestSchema, (q) => q.lte(TestSchema.fields.age, 25))
			expect(results.map((r) => r.name).sort()).toEqual(['Bob', 'Dave'])
		})

		test('in filter op matches values in array', async () => {
			const { repo } = makeE2eRepo()
			await seedData(repo)
			const results = await repo.findMany(TestSchema, (q) => q.in(TestSchema.fields.name, ['Alice', 'Carol']))
			expect(results.map((r) => r.name).sort()).toEqual(['Alice', 'Carol'])
		})

		test('notIn filter op excludes values in array', async () => {
			const { repo } = makeE2eRepo()
			await seedData(repo)
			const results = await repo.findMany(TestSchema, (q) => q.notIn(TestSchema.fields.name, ['Alice', 'Carol']))
			expect(results.map((r) => r.name).sort()).toEqual(['Bob', 'Dave'])
		})

		test('like filter op matches substring case-insensitively', async () => {
			const { repo } = makeE2eRepo()
			await seedData(repo)
			const results = await repo.findMany(TestSchema, (q) => q.like(TestSchema.fields.name, 'ali'))
			expect(results).toHaveLength(1)
			expect(results[0].name).toBe('Alice')
		})

		test('exists filter op matches non-null values', async () => {
			const { repo } = makeE2eRepo()
			await seedData(repo)
			const results = await repo.findMany(TestSchema, (q) => q.exists(TestSchema.fields.score))
			expect(results).toHaveLength(1)
			expect(results[0].name).toBe('Dave')
		})

		test('notExists filter op matches null/undefined values', async () => {
			const { repo } = makeE2eRepo()
			await seedData(repo)
			const results = await repo.findMany(TestSchema, (q) => q.notExists(TestSchema.fields.score))
			expect(results).toHaveLength(3)
		})

		test('contains filter op matches array subset', async () => {
			const { repo } = makeE2eRepo()
			await seedData(repo)
			const results = await repo.findMany(TestSchema, (q) => q.contains('tags', ['admin']))
			expect(results.map((r) => r.name).sort()).toEqual(['Alice', 'Carol'])
		})

		test('notContains filter op excludes array subset', async () => {
			const { repo } = makeE2eRepo()
			await seedData(repo)
			const results = await repo.findMany(TestSchema, (q) => q.notContains('tags', ['admin']))
			expect(results.map((r) => r.name).sort()).toEqual(['Bob', 'Dave'])
		})

		test('and combinator requires all conditions', async () => {
			const { repo } = makeE2eRepo()
			await seedData(repo)
			const results = await repo.findMany(TestSchema, (q) =>
				q.and([(g) => g.gt(TestSchema.fields.age, 20), (g) => g.eq(TestSchema.fields.active, true)]),
			)
			expect(results.map((r) => r.name).sort()).toEqual(['Alice', 'Carol', 'Dave'])
		})

		test('or combinator matches any condition', async () => {
			const { repo } = makeE2eRepo()
			await seedData(repo)
			const results = await repo.findMany(TestSchema, (q) =>
				q.or([(g) => g.eq(TestSchema.fields.name, 'Alice'), (g) => g.eq(TestSchema.fields.name, 'Bob')]),
			)
			expect(results.map((r) => r.name).sort()).toEqual(['Alice', 'Bob'])
		})

		test('raw-string field overload works end-to-end', async () => {
			const { repo } = makeE2eRepo()
			await seedData(repo)
			const results = await repo.findMany(TestSchema, (q) => q.eq('name', 'Alice'))
			expect(results).toHaveLength(1)
			expect(results[0].name).toBe('Alice')
		})

		test('empty and([]) throws at builder time', async () => {
			const { repo } = makeE2eRepo()
			await seedData(repo)
			await expect(repo.findMany(TestSchema, (q) => q.and([]))).rejects.toThrow()
		})

		test('empty or([]) throws at builder time', async () => {
			const { repo } = makeE2eRepo()
			await seedData(repo)
			await expect(repo.findMany(TestSchema, (q) => q.or([]))).rejects.toThrow()
		})

		test('unknown field in filter throws OrmValidationError at boundary', async () => {
			const { OrmValidationError: OrmValErr } = await import('../schema-validations')
			const { repo } = makeE2eRepo()
			await seedData(repo)
			await expect(repo.findMany(TestSchema, (q) => q.eq('nonexistentField', 42))).rejects.toBeInstanceOf(OrmValErr)
		})
	})

	describe('type-level: per-op gating on FilterGroup', () => {
		test('undeclared filter op is never on GatedFilterGroup', () => {
			const { GatedFilterGroup: _type } = {} as any
			type EqOnlyOps = readonly ['eq']
			type Gated = import('../filter').GatedFilterGroup<EqOnlyOps>
			expectTypeOf<Gated['eq']>().not.toBeNever()
			expectTypeOf<Gated['ne']>().toBeNever()
			expectTypeOf<Gated['gt']>().toBeNever()
			expectTypeOf<Gated['and']>().not.toBeNever()
			expectTypeOf<Gated['or']>().not.toBeNever()
		})

		test('all declared ops are available, undeclared are never', () => {
			type TwoOps = readonly ['eq', 'gt']
			type Gated = import('../filter').GatedFilterGroup<TwoOps>
			expectTypeOf<Gated['eq']>().not.toBeNever()
			expectTypeOf<Gated['gt']>().not.toBeNever()
			expectTypeOf<Gated['ne']>().toBeNever()
			expectTypeOf<Gated['lt']>().toBeNever()
			expectTypeOf<Gated['in']>().toBeNever()
		})
	})

	describe('type-level: co-required pair (queryable needs queryableOps)', () => {
		test('queryable without queryableOps is a TS error and runtime throw', () => {
			expect(() =>
				// @ts-expect-error — queryable() without queryableOps() is a compile error
				defineAdapter((a) => a.queryable({ findMany: async () => [] })),
			).toThrow()
		})

		test('queryable after queryableOps with zero ops is a TS error and runtime throw', () => {
			expect(() =>
				defineAdapter((a) => {
					const b = a.queryableOps()
					// @ts-expect-error — queryable() after empty queryableOps should fail
					return b.queryable({ findMany: async () => [] })
				}),
			).toThrow()
		})

		test('queryable with non-empty queryableOps compiles', () => {
			const _adapter = defineAdapter((a) => a.queryableOps('eq').queryable({ findMany: async () => [] }))
			expect(_adapter.queryableOps).toEqual(['eq'])
		})
	})

	describe('type-level: missing queryableOps makes findMany never', () => {
		test('adapter without queryableOps yields never findMany on repo', () => {
			const _crudOnlyAdapter = defineAdapter((a) => a.supportedFieldTypes('string').crud({ findByPk: async () => null }))
			type Ops = import('../adapter').InferAdapterQueryableOps<typeof _crudOnlyAdapter>
			expectTypeOf<Ops>().toEqualTypeOf<readonly []>()
		})
	})

	describe('type-level: repo method gating', () => {
		test('missing queryable.updateMany collapses repo.updateOne and repo.updateMany to never', () => {
			const _adapter = defineAdapter((a) =>
				a.supportedFieldTypes('string').crud({ findByPk: async () => null }),
			)
			const _repo = defineRepo((r) => r.adapter(_adapter).resolve(() => ({})))
			expectTypeOf(_repo.updateOne).toBeNever()
			expectTypeOf(_repo.updateMany).toBeNever()
		})

		test('missing queryable.deleteMany collapses repo.deleteOne and repo.deleteMany to never', () => {
			const _adapter = defineAdapter((a) =>
				a.supportedFieldTypes('string').crud({ findByPk: async () => null }),
			)
			const _repo = defineRepo((r) => r.adapter(_adapter).resolve(() => ({})))
			expectTypeOf(_repo.deleteOne).toBeNever()
			expectTypeOf(_repo.deleteMany).toBeNever()
		})

		test('missing crud.raw collapses repo.raw to never', () => {
			const _adapter = defineAdapter((a) =>
				a.supportedFieldTypes('string').crud({ findByPk: async () => null }),
			)
			const _repo = defineRepo((r) => r.adapter(_adapter).resolve(() => ({})))
			expectTypeOf(_repo.raw).toBeNever()
		})

		test('missing crud.deleteByPk collapses repo.deleteByPk to never', () => {
			const _adapter = defineAdapter((a) =>
				a.supportedFieldTypes('string').crud({ findByPk: async () => null }),
			)
			const _repo = defineRepo((r) => r.adapter(_adapter).resolve(() => ({})))
			expectTypeOf(_repo.deleteByPk).toBeNever()
		})

		test('missing crud.updateByPk collapses repo.updateByPk to never', () => {
			const _adapter = defineAdapter((a) =>
				a.supportedFieldTypes('string').crud({ findByPk: async () => null }),
			)
			const _repo = defineRepo((r) => r.adapter(_adapter).resolve(() => ({})))
			expectTypeOf(_repo.updateByPk).toBeNever()
		})

		test('adapter with queryable.updateMany enables repo.updateOne and repo.updateMany', () => {
			const _adapter = defineAdapter((a) =>
				a
					.supportedFieldTypes('string')
					.queryableOps('eq')
					.queryable({ findMany: async () => [], updateMany: async () => [] }),
			)
			const _repo = defineRepo((r) => r.adapter(_adapter).resolve(() => ({})))
			expectTypeOf(_repo.updateOne).toBeFunction()
			expectTypeOf(_repo.updateMany).toBeFunction()
		})

		test('adapter with queryable.deleteMany enables repo.deleteOne and repo.deleteMany', () => {
			const _adapter = defineAdapter((a) =>
				a
					.supportedFieldTypes('string')
					.queryableOps('eq')
					.queryable({ findMany: async () => [], deleteMany: async () => [] }),
			)
			const _repo = defineRepo((r) => r.adapter(_adapter).resolve(() => ({})))
			expectTypeOf(_repo.deleteOne).toBeFunction()
			expectTypeOf(_repo.deleteMany).toBeFunction()
		})

		test('adapter with crud.deleteByPk and crud.raw enables those repo methods', () => {
			const _adapter = defineAdapter((a) =>
				a
					.supportedFieldTypes('string')
					.crud({
						findByPk: async () => null,
						deleteByPk: async () => null,
						raw: async () => { throw new Error('not implemented') },
					}),
			)
			const _repo = defineRepo((r) => r.adapter(_adapter).resolve(() => ({})))
			expectTypeOf(_repo.deleteByPk).toBeFunction()
			expectTypeOf(_repo.raw).toBeFunction()
		})
	})

	describe('repo.updateByPk', () => {
		let viewCounter = 0
		const ItemSchema = defineSchema('items', (s) =>
			s
				.pk('id', v.string(), () => `item-${++viewCounter}`)
				.field('title', v.string())
				.field('views', v.number())
				.field('updatedAt', v.number(), { onCreate: () => 1000, onUpdate: () => Date.now() }),
		)

		function makeUpdateRepo() {
			const { adapter } = createInMemoryAdapter()
			return defineRepo((r) => r.adapter(adapter).resolve((s) => ({ prefix: s.name })))
		}

		test('round-trip update via updateByPk', async () => {
			const { set } = await import('../updates')
			const repo = makeUpdateRepo()
			const item = await repo.from(ItemSchema).one().insert({ title: 'Hello', views: 0 })
			const updated = await repo.updateByPk(ItemSchema, item.id, set<typeof ItemSchema>({ title: 'Updated' }))
			expect(updated).not.toBeNull()
			expect(updated!.title).toBe('Updated')
			expect(updated!.views).toBe(0)

			const found = await repo.findByPk(ItemSchema, item.id)
			expect(found!.title).toBe('Updated')
		})

		test('auto-bump injects updatedAt on un-touched onUpdate field', async () => {
			const { set } = await import('../updates')
			const repo = makeUpdateRepo()
			const item = await repo.from(ItemSchema).one().insert({ title: 'Hello', views: 0 })
			const before = item.updatedAt

			const updated = await repo.updateByPk(ItemSchema, item.id, set<typeof ItemSchema>({ title: 'Changed' }))
			expect(updated!.updatedAt).not.toBe(before)
			expect(updated!.updatedAt).toBeGreaterThanOrEqual(before)
		})

		test('user set({updatedAt:X}) suppresses auto-bump', async () => {
			const { set } = await import('../updates')
			const repo = makeUpdateRepo()
			const item = await repo.from(ItemSchema).one().insert({ title: 'Hello', views: 0 })

			const updated = await repo.updateByPk(ItemSchema, item.id, set<typeof ItemSchema>({ updatedAt: 9999 }))
			expect(updated!.updatedAt).toBe(9999)
		})

		test('set({views:0}) + inc(views, 1) throws collected conflict error', async () => {
			const { set, inc } = await import('../updates')
			const { OrmValidationError } = await import('../schema-validations')
			const repo = makeUpdateRepo()
			const item = await repo.from(ItemSchema).one().insert({ title: 'Hello', views: 0 })

			await expect(
				repo.updateByPk(
					ItemSchema,
					item.id,
					set<typeof ItemSchema>({ views: 0 }),
					inc<typeof ItemSchema>(ItemSchema.fields.views, 1),
				),
			).rejects.toThrow(OrmValidationError)

			try {
				await repo.updateByPk(
					ItemSchema,
					item.id,
					set<typeof ItemSchema>({ views: 0 }),
					inc<typeof ItemSchema>(ItemSchema.fields.views, 1),
				)
			} catch (e) {
				const err = e as InstanceType<typeof OrmValidationError>
				expect(err.kind).toBe('conflicting-ops')
				expect(err.failures[0].field).toBe('views')
			}
		})

		test('updateByPk with inc op', async () => {
			const { inc } = await import('../updates')
			const repo = makeUpdateRepo()
			const item = await repo.from(ItemSchema).one().insert({ title: 'Hello', views: 10 })

			const updated = await repo.updateByPk(ItemSchema, item.id, inc<typeof ItemSchema>(ItemSchema.fields.views, 5))
			expect(updated!.views).toBe(15)
		})

		test('updateByPk returns null for missing pk', async () => {
			const { set } = await import('../updates')
			const repo = makeUpdateRepo()
			const result = await repo.updateByPk(ItemSchema, 'nonexistent', set<typeof ItemSchema>({ title: 'X' }))
			expect(result).toBeNull()
		})

		test('updateByPk requires ≥1 op (type-level)', () => {
			const _repo = makeUpdateRepo()
			// @ts-expect-error — updateByPk requires at least one op argument
			void ((_r: typeof _repo) => _r.updateByPk(ItemSchema, 'id'))
		})
	})

	describe('repo.session — transactional behaviour', () => {
		const SchemaA = defineSchema('accounts', (s) =>
			s
				.pk('id', v.string(), () => `a-${Math.random().toString(36).slice(2)}`)
				.field('balance', v.number()),
		)
		const SchemaB = defineSchema('ledger', (s) =>
			s
				.pk('id', v.string(), () => `l-${Math.random().toString(36).slice(2)}`)
				.field('amount', v.number())
				.field('accountId', v.string()),
		)

		function makeSessionRepo() {
			const { adapter } = createInMemoryAdapter()
			return defineRepo((r) => r.adapter(adapter).resolve((s) => ({ prefix: s.name })))
		}

		test('throw-to-rollback: uncaught throw rolls back all writes and rejects with same error', async () => {
			const repo = makeSessionRepo()
			await repo.insertOne(SchemaA, { balance: 100 })

			const err = new Error('boom')
			await expect(
				repo.session(async () => {
					await repo.insertOne(SchemaA, { balance: 200 })
					throw err
				}),
			).rejects.toBe(err)

			const all = await repo.findMany(SchemaA, (q) => q.gte('balance', 0))
			expect(all).toHaveLength(1)
			expect(all[0].balance).toBe(100)
		})

		test('return-to-commit: successful return commits and resolves with callback value', async () => {
			const repo = makeSessionRepo()
			const result = await repo.session(async () => {
				await repo.insertOne(SchemaA, { balance: 500 })
				return 'committed'
			})

			expect(result).toBe('committed')
			const all = await repo.findMany(SchemaA, (q) => q.gte('balance', 0))
			expect(all).toHaveLength(1)
			expect(all[0].balance).toBe(500)
		})

		test('cross-schema session: multiple schemas share one tx; on throw both roll back', async () => {
			const repo = makeSessionRepo()
			const account = await repo.insertOne(SchemaA, { balance: 1000 })

			await expect(
				repo.session(async () => {
					await repo.updateMany(SchemaA, (q) => q.eq('id', account.id), { balance: 900 })
					await repo.insertOne(SchemaB, { amount: 100, accountId: account.id })
					throw new Error('tx failure')
				}),
			).rejects.toThrow('tx failure')

			const acct = await repo.findByPk(SchemaA, account.id)
			expect(acct!.balance).toBe(1000)

			const entries = await repo.findMany(SchemaB, (q) => q.eq('accountId', account.id))
			expect(entries).toHaveLength(0)
		})

		test('nested session: inner repo.session delegates to adapter (flat in in-memory)', async () => {
			const repo = makeSessionRepo()

			const result = await repo.session(async () => {
				await repo.insertOne(SchemaA, { balance: 100 })
				const inner = await repo.session(async () => {
					await repo.insertOne(SchemaA, { balance: 200 })
					return 'inner'
				})
				return inner
			})

			expect(result).toBe('inner')
			const all = await repo.findMany(SchemaA, (q) => q.gte('balance', 0))
			expect(all).toHaveLength(2)
		})

		test('nested session: throw in inner rolls back entire outer tx (flat nesting)', async () => {
			const repo = makeSessionRepo()
			await repo.insertOne(SchemaA, { balance: 50 })

			await expect(
				repo.session(async () => {
					await repo.insertOne(SchemaA, { balance: 100 })
					await repo.session(async () => {
						await repo.insertOne(SchemaA, { balance: 200 })
						throw new Error('inner boom')
					})
				}),
			).rejects.toThrow('inner boom')

			const all = await repo.findMany(SchemaA, (q) => q.gte('balance', 0))
			expect(all).toHaveLength(1)
			expect(all[0].balance).toBe(50)
		})

		test('no-tx-argument rule: session callback receives no arguments', async () => {
			const repo = makeSessionRepo()
			let argCount = -1
			await repo.session(async function () {
				argCount = arguments.length
			})
			expect(argCount).toBe(0)
		})
	})

	describe('type-level: session gating', () => {
		test('missing transactional.session collapses repo.session to never', () => {
			const _adapter = defineAdapter((a) =>
				a.supportedFieldTypes('string').crud({ findByPk: async () => null }),
			)
			const _repo = defineRepo((r) => r.adapter(_adapter).resolve(() => ({})))
			expectTypeOf(_repo.session).toBeNever()
		})

		test('adapter with transactional.session enables repo.session', () => {
			const _adapter = defineAdapter((a) =>
				a
					.supportedFieldTypes('string')
					.crud({ findByPk: async () => null })
					.transactional({ session: async (fn) => fn() }),
			)
			const _repo = defineRepo((r) => r.adapter(_adapter).resolve(() => ({})))
			expectTypeOf(_repo.session).toBeFunction()
		})
	})

	describe('zero-ALS rule: library code does not import node:async_hooks', () => {
		test('no file under src/orm (excluding adapters/) imports node:async_hooks', async () => {
			const { readdir, readFile } = await import('node:fs/promises')
			const { join } = await import('node:path')
			const forbidden = ['node:', 'async_hooks'].join('')

			async function* walk(dir: string): AsyncGenerator<string> {
				const entries = await readdir(dir, { withFileTypes: true })
				for (const entry of entries) {
					const full = join(dir, entry.name)
					if (entry.isDirectory()) {
						if (entry.name === 'adapters') continue
						yield* walk(full)
					} else if (entry.name.endsWith('.ts')) {
						yield full
					}
				}
			}

			const ormDir = join(import.meta.dirname!, '..')
			const violations: string[] = []
			for await (const file of walk(ormDir)) {
				const content = await readFile(file, 'utf-8')
				const importLine = /^\s*import\s.*from\s+['"].*async_hooks/m
				if (content.includes(forbidden) && importLine.test(content)) {
					violations.push(file)
				}
			}
			expect(violations).toEqual([])
		})
	})
}
