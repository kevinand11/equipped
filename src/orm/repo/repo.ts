import { AsyncLocalStorage } from 'node:async_hooks'

import { SchemaContext, SchemaRef } from './builders'
import type { InferAdapterConfig, SchemaCompatible } from '../adapter'
import type { OrmAdapterLike } from '../adapters/base'
import type { AnySchema, SchemaPersistedOutput } from '../schema'

export class Repo<A extends OrmAdapterLike<any>> {
	readonly #adapter: A
	readonly #defaults: (schema: AnySchema) => InferAdapterConfig<A>
	readonly #resolverStore = new AsyncLocalStorage<
		((config: InferAdapterConfig<A>, schema: AnySchema) => InferAdapterConfig<A>) | undefined
	>()

	constructor({ adapter, resolve }: { adapter: A; resolve: (schema: AnySchema) => InferAdapterConfig<A> }) {
		this.#adapter = adapter
		this.#defaults = resolve
	}

	#getConfig(s: AnySchema): InferAdapterConfig<A> {
		const resolver = this.#resolverStore.getStore()
		const base = this.#defaults(s)
		return resolver ? resolver(base, s) : base
	}

	#getUse(s: AnySchema) {
		return this.#adapter.use(s, this.#getConfig(s))
	}

	from<S extends AnySchema>(schema: S): SchemaRef<S> {
		return new SchemaRef<S>(new SchemaContext(schema, (target) => this.#getUse(target)))
	}

	async findByPk<S extends AnySchema>(
		schema: SchemaCompatible<A, S>,
		pk: unknown,
	): Promise<SchemaPersistedOutput<S> | null> {
		const s = schema as unknown as AnySchema
		const config = this.#getConfig(s)
		const adapter = this.#adapter as any
		if (adapter.crud?.findByPk) {
			const result = await adapter.crud.findByPk(s, config, pk)
			return (result as SchemaPersistedOutput<S>) ?? null
		}
		throw new Error('Adapter does not implement crud.findByPk')
	}

	async session<T>(fn: (tx: Repo<A>) => Promise<T>): Promise<T> {
		return this.#adapter.session(() => fn(this))
	}

	async resolve<T>(
		resolver: (config: InferAdapterConfig<A>, schema: AnySchema) => InferAdapterConfig<A>,
		fn: () => Promise<T>,
	): Promise<T> {
		const outerResolver = this.#resolverStore.getStore()
		const chained = outerResolver ? (config: InferAdapterConfig<A>, s: AnySchema) => resolver(outerResolver(config, s), s) : resolver
		return this.#resolverStore.run(chained, fn)
	}
}

class RepoBuilder<A = never, Config = never> {
	#adapter: unknown
	#resolve: unknown

	adapter<NewA>(a: [A] extends [never] ? NewA : never): RepoBuilder<NewA, Config> {
		this.#adapter = a
		return this as unknown as RepoBuilder<NewA, Config>
	}

	resolve<NewConfig>(fn: [Config] extends [never] ? (schema: AnySchema) => NewConfig : never): RepoBuilder<A, NewConfig> {
		this.#resolve = fn
		return this as unknown as RepoBuilder<A, NewConfig>
	}

	_build() {
		return { adapter: this.#adapter, resolve: this.#resolve }
	}
}

export function defineRepo<A extends OrmAdapterLike<any>, Config>(
	build: (b: RepoBuilder) => RepoBuilder<A, Config>,
): Repo<A> {
	const data = build(new RepoBuilder())._build()
	return new Repo<A>({ adapter: data.adapter as A, resolve: data.resolve as any })
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

		const OrgSchema = defineSchema('orgs', (s) =>
			s.pk('id', v.string(), () => `o${++orgCounter}`).field('name', v.string()),
		)

		const PersonSchema = defineSchema('people', (s) =>
			s
				.pk('id', v.string(), () => `person-${++userCounter}`)
				.field('firstName', v.string())
				.field('lastName', v.string())
				.computed('fullName', ['firstName', 'lastName'], v.string(), ({ firstName, lastName }) => `${firstName} ${lastName}`),
		)

		const UserRels = defineRelations(UserSchema, (rel, src) => rel
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

			const insertedId = await repo.session(async (tx) => {
				const created = await tx.from(UserSchema).one().insert({ email: 'tx@fluent.com', name: 'Tx Fluent' })
				await tx.from(UserSchema).one().id(created.id).update({ name: 'Tx Fluent Updated' })
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
			const result = await repo.session(async (tx) => {
				const inserted = await tx.from(UserSchema).one().insert({ email: 't@test.com', name: 'TxUser' })
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
			const updated = await repo
				.from(UserSchema)
				.one()
				.id(user.id)
				.preload([UserRels.posts])
				.update({ name: 'Updated' })
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
	})

	describe('type-level: defineRepo builder uniqueness', () => {
		test('duplicate .adapter() call is a TS error', () => {
			const { adapter } = createInMemoryAdapter()
			// @ts-expect-error — calling adapter() twice should fail
			defineRepo((r) => r.adapter(adapter).adapter(adapter).resolve((s) => ({ prefix: s.name })))
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
			const _adapter = defineAdapter((a) =>
				a.supportedFieldTypes('string').crud({ findByPk: async () => null }),
			)
			const _TestSchema = defineSchema('test', (s) => s.pk('id', v.string(), () => 'x'))
			const _repo = defineRepo((r) => r.adapter(_adapter).resolve(() => ({})))
			expectTypeOf(_repo.findByPk<typeof _TestSchema>).toBeFunction()
		})
	})
}
