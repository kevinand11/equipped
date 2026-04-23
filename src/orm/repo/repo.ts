import { AsyncLocalStorage } from 'node:async_hooks'

import type { InferAdapterConfig, OrmAdapter, OrmUse } from '../adapters/base'
import type { QueryFilter, QueryOptions } from '../query'
import type { AnyPreloadDef, PreloadedMap } from '../relations'
import type { AnySchema, SchemaOutput } from '../schema'
import { validateInsert, validateUpdate, type SchemaInsertInput, type SchemaUpdateInput } from '../schema-validations'
import { resolvePreloads } from './preloads'
import type { Selected } from './types'

export class Repo<A extends OrmAdapter<any>> {
	readonly #adapter: A
	readonly #defaults: (schema: AnySchema) => InferAdapterConfig<A>
	readonly #resolverStore = new AsyncLocalStorage<
		((config: InferAdapterConfig<A>, schema: AnySchema) => InferAdapterConfig<A>) | undefined
	>()

	constructor({ adapter, defaults }: { adapter: A; defaults: (schema: AnySchema) => InferAdapterConfig<A> }) {
		this.#adapter = adapter
		this.#defaults = defaults
	}

	#getConfig(s: AnySchema): InferAdapterConfig<A> {
		const resolver = this.#resolverStore.getStore()
		const base = this.#defaults(s)
		return resolver ? resolver(base, s) : base
	}

	#getUse(s: AnySchema): OrmUse {
		return this.#adapter.use(s, this.#getConfig(s))
	}

	async findOne<S extends AnySchema, P extends readonly AnyPreloadDef[] = []>(
		s: S,
		filter: QueryFilter,
		options?: { preloads?: P },
	): Promise<(SchemaOutput<S> & PreloadedMap<P>) | null> {
		const result = await this.#getUse(s).findOne(filter)
		if (!result) return null
		const { preloads } = options ?? {}
		if (!preloads || preloads.length === 0) return result as any
		const [resolved] = await resolvePreloads([result], [...preloads], (schema) => this.#getUse(schema))
		return (resolved ?? null) as any
	}

	async findMany<S extends AnySchema, P extends readonly AnyPreloadDef[] = [], Sel extends keyof SchemaOutput<S> & string = never>(
		s: S,
		filter: QueryFilter,
		options?: QueryOptions<Sel> & { preloads?: P },
	): Promise<(Selected<S, Sel> & PreloadedMap<P>)[]> {
		const { preloads, ...queryOptions } = options ?? {}
		const results = await this.#getUse(s).findMany(filter, queryOptions)
		const entities = results as SchemaOutput<typeof s>[]

		if (!preloads || preloads.length === 0) return entities as any

		return resolvePreloads(entities as Record<string, unknown>[], [...preloads], (schema) => this.#getUse(schema)) as any
	}

	async insertOne<S extends AnySchema, P extends readonly AnyPreloadDef[] = []>(
		s: S,
		data: SchemaInsertInput<S>,
		options?: { preloads?: P },
	): Promise<SchemaOutput<S> & PreloadedMap<P>> {
		const validated = validateInsert(s, data as Record<string, unknown>)
		const result = await this.#getUse(s).insertOne(validated as Record<string, unknown>)
		const { preloads } = options ?? {}
		if (!preloads || preloads.length === 0) return result as any
		const [resolved] = await resolvePreloads([result], [...preloads], (schema) => this.#getUse(schema))
		return resolved as any
	}

	async insertMany<S extends AnySchema, P extends readonly AnyPreloadDef[] = []>(
		s: S,
		data: SchemaInsertInput<S>[],
		options?: { preloads?: P },
	): Promise<(SchemaOutput<S> & PreloadedMap<P>)[]> {
		const validated = (data as Record<string, unknown>[]).map((d) => validateInsert(s, d) as Record<string, unknown>)
		const results = await this.#getUse(s).insertMany(validated)
		const { preloads } = options ?? {}
		if (!preloads || preloads.length === 0) return results as any
		return resolvePreloads(results, [...preloads], (schema) => this.#getUse(schema)) as any
	}

	async updateOne<S extends AnySchema, P extends readonly AnyPreloadDef[] = []>(
		s: S,
		filter: QueryFilter,
		data: SchemaUpdateInput<S>,
		options?: { preloads?: P },
	): Promise<(SchemaOutput<S> & PreloadedMap<P>) | null> {
		const validated = validateUpdate(s, data as Record<string, unknown>)
		const result = await this.#getUse(s).updateOne(filter, validated as Record<string, unknown>)
		if (!result) return null
		const { preloads } = options ?? {}
		if (!preloads || preloads.length === 0) return result as any
		const [resolved] = await resolvePreloads([result], [...preloads], (schema) => this.#getUse(schema))
		return (resolved ?? null) as any
	}

	async updateMany<S extends AnySchema, P extends readonly AnyPreloadDef[] = []>(
		s: S,
		filter: QueryFilter,
		data: SchemaUpdateInput<S>,
		options?: { preloads?: P },
	): Promise<(SchemaOutput<S> & PreloadedMap<P>)[]> {
		const validated = validateUpdate(s, data as Record<string, unknown>)
		const results = await this.#getUse(s).updateMany(filter, validated as Record<string, unknown>)
		const { preloads } = options ?? {}
		if (!preloads || preloads.length === 0) return results as any
		return resolvePreloads(results, [...preloads], (schema) => this.#getUse(schema)) as any
	}

	async upsertOne<S extends AnySchema>(
		s: S,
		filter: QueryFilter,
		data: { insert: SchemaInsertInput<S> } | { insert: SchemaInsertInput<S>; update: SchemaUpdateInput<S> },
	): Promise<SchemaOutput<S>> {
		const insert = validateInsert(s, data.insert as Record<string, unknown>)
		const update = 'update' in data ? validateUpdate(s, data.update as Record<string, unknown>) : undefined
		const result = await this.#getUse(s).upsertOne(
			filter,
			update
				? { insert: insert as Record<string, unknown>, update: update as Record<string, unknown> }
				: { insert: insert as Record<string, unknown> },
		)
		return result as SchemaOutput<typeof s>
	}

	async deleteOne<S extends AnySchema>(s: S, filter: QueryFilter): Promise<SchemaOutput<S> | null> {
		const result = await this.#getUse(s).deleteOne(filter)
		return (result ?? null) as SchemaOutput<typeof s> | null
	}

	async deleteMany<S extends AnySchema>(s: S, filter: QueryFilter): Promise<SchemaOutput<S>[]> {
		const results = await this.#getUse(s).deleteMany(filter)
		return results as SchemaOutput<typeof s>[]
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

if (import.meta.vitest) {
	const { describe, test, expect, vi } = import.meta.vitest
	const { v } = await import('valleyed')
	const { InMemoryOrm } = await import('../adapters/in-memory')
	const { eq, query } = await import('../query')
	const { Relations } = await import('../relations')
	const { Schema } = await import('../schema')

	describe('repo/Repo core behavior', () => {
		let userCounter = 0
		let postCounter = 0
		let profileCounter = 0
		let orgCounter = 0

		const UserSchema = Schema.from('users')
			.pk('id', v.string(), () => `u${++userCounter}`)
			.field('email', v.string())
			.field('name', v.string())
			.field('orgId', v.optional(v.string()), { onCreate: () => undefined })
			.field('createdAt', v.number(), { onCreate: () => 1000 })

		const PostSchema = Schema.from('posts')
			.pk('id', v.string(), () => `p${++postCounter}`)
			.field('title', v.string())
			.field('userId', v.string())

		const ProfileSchema = Schema.from('profiles')
			.pk('id', v.string(), () => `pr${++profileCounter}`)
			.field('bio', v.string())
			.field('userId', v.string())

		const OrgSchema = Schema.from('orgs')
			.pk('id', v.string(), () => `o${++orgCounter}`)
			.field('name', v.string())

		const UserRelations = Relations.of(UserSchema)
			.hasMany('posts', PostSchema, 'userId')
			.hasOne('profile', ProfileSchema, 'userId')
			.belongsTo('org', OrgSchema, 'orgId')

		function makeRepo() {
			const adapter = new InMemoryOrm()
			return new Repo({ adapter, defaults: (s) => ({ prefix: s.name }) })
		}

		test('insert/find/update/delete flows work', async () => {
			const repo = makeRepo()
			const user = await repo.insertOne(UserSchema, { email: 'a@b.com', name: 'Alice' })
			expect(user.id).toMatch(/^u\d+$/)
			expect(user.createdAt).toBe(1000)

			const found = await repo.findOne(UserSchema, query(eq('id', user.id)))
			expect(found?.id).toBe(user.id)

			const updated = await repo.updateOne(UserSchema, query(eq('id', user.id)), { name: 'Updated' })
			expect(updated?.name).toBe('Updated')

			const deleted = await repo.deleteOne(UserSchema, query(eq('id', user.id)))
			expect(deleted?.id).toBe(user.id)
		})

		test('insertMany, findMany and upsertOne work', async () => {
			const repo = makeRepo()
			await repo.insertMany(UserSchema, [
				{ email: 'a@b.com', name: 'Alice' },
				{ email: 'b@c.com', name: 'Bob' },
			])
			expect(await repo.findMany(UserSchema, query())).toHaveLength(2)

			const inserted = await repo.upsertOne(UserSchema, query(eq('id', 'u-fixed')), {
				insert: { email: 'new@test.com', name: 'New' },
			})
			expect(inserted.name).toBe('New')
		})

		test('resolve chains adapter config transforms', async () => {
			const seenConfigs: unknown[] = []
			const spyAdapter = new InMemoryOrm()
			const origUse = spyAdapter.use.bind(spyAdapter)
			spyAdapter.use = vi.fn((s, config) => {
				seenConfigs.push(config)
				return origUse(s, config)
			})

			const repo = new Repo({ adapter: spyAdapter, defaults: (s) => ({ prefix: s.name }) })

			await repo.resolve(
				(config) => ({ prefix: `a_${config.prefix}` }),
				async () => {
					await repo.resolve(
						(config) => ({ prefix: `b_${config.prefix}` }),
						async () => {
							await repo.findMany(UserSchema, query())
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
				const inserted = await tx.insertOne(UserSchema, { email: 't@test.com', name: 'TxUser' })
				insertedId = inserted.id
				return 42
			})

			expect(result).toBe(42)
			expect(await repo.findOne(UserSchema, query(eq('id', insertedId)))).not.toBeNull()
		})

		test('preloads can be resolved on mutation methods', async () => {
			const repo = makeRepo()
			const org = await repo.insertOne(OrgSchema, { name: 'Corp' })
			const user = await repo.insertOne(
				UserSchema,
				{ email: 'u@test.com', name: 'User', orgId: org.id },
				{ preloads: [UserRelations.definitions.org] as const },
			)
			expect((user.org as any).name).toBe('Corp')

			await repo.insertOne(PostSchema, { title: 'Post', userId: user.id })
			const updated = await repo.updateOne(
				UserSchema,
				query(eq('id', user.id)),
				{ name: 'Updated' },
				{ preloads: [UserRelations.definitions.posts] as const },
			)
			expect(updated?.posts).toHaveLength(1)
		})
	})
}
