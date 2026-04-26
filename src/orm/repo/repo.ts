import { AsyncLocalStorage } from 'node:async_hooks'

import { v, type Prettify } from 'valleyed'

import { EquippedError } from '../../errors'
import type { InferAdapterConfig, OrmAdapter, OrmUse } from '../adapters/base'
import type { QueryFilter, QueryOptions } from '../query'
import { eq, query } from '../query'
import type { AnyPreloadDef, PreloadedMap } from '../relations'
import type { AnySchema, SchemaOutput } from '../schema'
import { validateInsert, validateUpdate, type SchemaInsertInput, type SchemaUpdateInput } from '../schema-validations'
import { resolvePreloads } from './preloads'
import type { Selected } from './types'

type SchemaPrimaryKeyValue<S extends AnySchema> = SchemaOutput<S>[S['pkField']['name'] & keyof SchemaOutput<S>]
type ComputedSelectionPlan = {
	requestedSelect: Set<string> | null
	adapterSelect?: string[]
	computeNames: string[]
}

export class Repo<A extends OrmAdapter<any>> {
	readonly #adapter: A
	readonly #defaults: (schema: AnySchema) => InferAdapterConfig<A>
	readonly #resolverStore = new AsyncLocalStorage<
		((config: InferAdapterConfig<A>, schema: AnySchema) => InferAdapterConfig<A>) | undefined
	>()

	private constructor({ adapter, resolve }: { adapter: A; resolve: (schema: AnySchema) => InferAdapterConfig<A> }) {
		this.#adapter = adapter
		this.#defaults = resolve
	}

	static from<A extends OrmAdapter<any>>({ adapter, resolve }: { adapter: A; resolve: (schema: AnySchema) => InferAdapterConfig<A> }) {
		return new Repo<A>({ adapter, resolve })
	}

	#getConfig(s: AnySchema): InferAdapterConfig<A> {
		const resolver = this.#resolverStore.getStore()
		const base = this.#defaults(s)
		return resolver ? resolver(base, s) : base
	}

	#getUse(s: AnySchema): OrmUse {
		return this.#adapter.use(s, this.#getConfig(s))
	}

	#planComputedSelection(s: AnySchema, select?: readonly string[]): ComputedSelectionPlan {
		const computedDefs = s.computedDefs as Record<string, { deps: readonly string[] }>
		const computedNames = new Set(Object.keys(computedDefs))
		const persistedNames = new Set(Object.keys(s.fields))

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
				schema: s.name,
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

	#applyComputedSelection(s: AnySchema, rows: Record<string, unknown>[], plan: ComputedSelectionPlan): Record<string, unknown>[] {
		const computedDefs = s.computedDefs as Record<
			string,
			{ pipe: Parameters<typeof v.assert>[0]; deps: readonly string[]; compute: (data: Record<string, unknown>) => unknown }
		>

		return rows.map((row) => {
			const enriched: Record<string, unknown> = { ...row }
			for (const computeName of plan.computeNames) {
				const def = computedDefs[computeName]
				const depInput: Record<string, unknown> = {}
				for (const dep of def.deps) {
					if (!(dep in row)) {
						throw new EquippedError('Computed field dependency missing from adapter result', {
							schema: s.name,
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

	async findOne<S extends AnySchema, P extends readonly AnyPreloadDef[] = []>(
		s: S,
		filter: QueryFilter,
		options?: { preloads?: P },
	): Promise<Prettify<SchemaOutput<S> & PreloadedMap<P>> | null> {
		const result = await this.#getUse(s).findOne(filter)
		if (!result) return null
		const [computedResult] = this.#applyComputedSelection(s, [result], this.#planComputedSelection(s))
		const { preloads } = options ?? {}
		if (!preloads || preloads.length === 0) return computedResult as any
		const [resolved] = await resolvePreloads([computedResult], [...preloads], (schema) => this.#getUse(schema))
		return (resolved ?? null) as any
	}

	async findById<S extends AnySchema, P extends readonly AnyPreloadDef[] = []>(
		s: S,
		id: SchemaPrimaryKeyValue<S>,
		options?: { preloads?: P },
	): Promise<Prettify<SchemaOutput<S> & PreloadedMap<P>> | null> {
		return this.findOne(s, query(eq(s.pkField, id)), options)
	}

	async findMany<S extends AnySchema, P extends readonly AnyPreloadDef[] = [], Sel extends keyof SchemaOutput<S> & string = never>(
		s: S,
		filter: QueryFilter,
		options?: QueryOptions<Sel> & { preloads?: P },
	): Promise<Prettify<Selected<S, Sel> & PreloadedMap<P>>[]> {
		const { preloads, ...queryOptions } = options ?? {}
		const plan = this.#planComputedSelection(s, queryOptions?.select as string[] | undefined)
		const adapterQueryOptions: QueryOptions | undefined = queryOptions
			? ({ ...queryOptions, select: plan.adapterSelect } as QueryOptions)
			: undefined
		const results = await this.#getUse(s).findMany(filter, adapterQueryOptions)
		const entities = this.#applyComputedSelection(s, results as Record<string, unknown>[], plan) as SchemaOutput<typeof s>[]

		if (!preloads || preloads.length === 0) return entities as any

		return resolvePreloads(entities as Record<string, unknown>[], [...preloads], (schema) => this.#getUse(schema)) as any
	}

	async insertOne<S extends AnySchema, P extends readonly AnyPreloadDef[] = []>(
		s: S,
		data: SchemaInsertInput<S>,
		options?: { preloads?: P },
	): Promise<Prettify<SchemaOutput<S> & PreloadedMap<P>>> {
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
	): Promise<Prettify<SchemaOutput<S> & PreloadedMap<P>>[]> {
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
	): Promise<Prettify<SchemaOutput<S> & PreloadedMap<P>> | null> {
		const validated = validateUpdate(s, data as Record<string, unknown>)
		const result = await this.#getUse(s).updateOne(filter, validated as Record<string, unknown>)
		if (!result) return null
		const { preloads } = options ?? {}
		if (!preloads || preloads.length === 0) return result as any
		const [resolved] = await resolvePreloads([result], [...preloads], (schema) => this.#getUse(schema))
		return (resolved ?? null) as any
	}

	async updateById<S extends AnySchema, P extends readonly AnyPreloadDef[] = []>(
		s: S,
		id: SchemaPrimaryKeyValue<S>,
		data: SchemaUpdateInput<S>,
		options?: { preloads?: P },
	): Promise<Prettify<SchemaOutput<S> & PreloadedMap<P>> | null> {
		return this.updateOne(s, query(eq(s.pkField, id)), data, options)
	}

	async updateMany<S extends AnySchema, P extends readonly AnyPreloadDef[] = []>(
		s: S,
		filter: QueryFilter,
		data: SchemaUpdateInput<S>,
		options?: { preloads?: P },
	): Promise<Prettify<SchemaOutput<S> & PreloadedMap<P>>[]> {
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

	async deleteById<S extends AnySchema>(s: S, id: SchemaPrimaryKeyValue<S>): Promise<SchemaOutput<S> | null> {
		return this.deleteOne(s, query(eq(s.pkField, id)))
	}

	async deleteMany<S extends AnySchema>(s: S, filter: QueryFilter): Promise<SchemaOutput<S>[]> {
		const results = await this.#getUse(s).deleteMany(filter)
		return results as SchemaOutput<typeof s>[]
	}

	async raw<S extends AnySchema, T = unknown>(s: S, command: unknown, params?: unknown[]): Promise<T> {
		const use = this.#getUse(s)
		if (!use.raw) {
			throw new EquippedError('Raw operations are not supported by this adapter', {
				operation: 'raw',
				schema: s.name,
			})
		}
		return use.raw<T>(command, params)
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

		const PersonSchema = Schema.from('people')
			.pk('id', v.string(), () => `person-${++userCounter}`)
			.field('firstName', v.string())
			.field('lastName', v.string())
			.computed('fullName', ['firstName', 'lastName'], v.string(), ({ firstName, lastName }) => `${firstName} ${lastName}`)

		const UserRelations = Relations.of(UserSchema)
			.hasMany('posts', PostSchema, 'userId')
			.hasOne('profile', ProfileSchema, 'userId')
			.belongsTo('org', OrgSchema, 'orgId')

		function makeRepo() {
			const adapter = new InMemoryOrm()
			return Repo.from({ adapter, resolve: (s) => ({ prefix: s.name }) })
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

		test('findById, updateById, and deleteById target the schema primary key', async () => {
			const repo = makeRepo()
			const user = await repo.insertOne(UserSchema, { email: 'id@test.com', name: 'ById' })

			const found = await repo.findById(UserSchema, user.id)
			expect(found?.id).toBe(user.id)

			const updated = await repo.updateById(UserSchema, user.id, { name: 'Changed' })
			expect(updated?.name).toBe('Changed')

			const deleted = await repo.deleteById(UserSchema, user.id)
			expect(deleted?.id).toBe(user.id)
			expect(await repo.findById(UserSchema, user.id)).toBeNull()
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

			const repo = Repo.from({ adapter: spyAdapter, resolve: (s) => ({ prefix: s.name }) })

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
				{ preloads: [UserRelations.definitions.org] },
			)
			expect((user.org as any).name).toBe('Corp')

			await repo.insertOne(PostSchema, { title: 'Post', userId: user.id })
			const updated = await repo.updateOne(
				UserSchema,
				query(eq('id', user.id)),
				{ name: 'Updated' },
				{ preloads: [UserRelations.definitions.posts] },
			)
			expect(updated?.posts).toHaveLength(1)
		})

		test('raw operations throw EquippedError on in-memory adapter', async () => {
			const repo = makeRepo()
			const error = await repo.raw(UserSchema, 'SELECT * FROM users').catch((e) => e)
			expect(error).toBeInstanceOf(EquippedError)
		})

		test('computed fields are derived and shaped correctly when selected', async () => {
			const repo = makeRepo()
			const created = await repo.insertOne(PersonSchema, { firstName: 'Ada', lastName: 'Lovelace' })
			const rows = await repo.findMany(PersonSchema, query(), { select: ['id', 'fullName'] })

			expect(rows).toEqual([{ id: created.id, fullName: 'Ada Lovelace' }])
		})

		test('computed field selection auto-includes dependencies for adapter reads', async () => {
			const adapter = new InMemoryOrm()
			const origUse = adapter.use.bind(adapter)
			let seenSelect: string[] | undefined
			adapter.use = vi.fn((schema, config) => {
				const use = origUse(schema, config)
				return {
					...use,
					findMany: async (filter, options) => {
						seenSelect = options?.select as string[] | undefined
						return use.findMany(filter, options)
					},
				}
			})

			const repo = Repo.from({ adapter, resolve: (s) => ({ prefix: s.name }) })
			await repo.insertOne(PersonSchema, { firstName: 'Grace', lastName: 'Hopper' })
			await repo.findMany(PersonSchema, query(), { select: ['id', 'fullName'] })

			expect(seenSelect).toEqual(expect.arrayContaining(['id', 'firstName', 'lastName']))
		})

		test('missing computed dependencies in adapter output fail fast', async () => {
			const adapter = new InMemoryOrm()
			const origUse = adapter.use.bind(adapter)
			adapter.use = vi.fn((schema, config) => {
				const use = origUse(schema, config)
				return {
					...use,
					findMany: async (filter, options) => {
						const rows = await use.findMany(filter, options)
						return rows.map((row) => {
							const next = { ...row }
							delete (next as any).lastName
							return next
						})
					},
				}
			})

			const repo = Repo.from({ adapter, resolve: (s) => ({ prefix: s.name }) })
			await repo.insertOne(PersonSchema, { firstName: 'Katherine', lastName: 'Johnson' })

			await expect(repo.findMany(PersonSchema, query(), { select: ['fullName'] })).rejects.toBeInstanceOf(EquippedError)
		})
	})
}
