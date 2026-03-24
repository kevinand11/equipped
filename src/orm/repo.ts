import { AsyncLocalStorage } from 'node:async_hooks'

import type { InferAdapterConfig, OrmAdapter, OrmUse, PaginatedResult } from './adapters/base'
import type { QueryFilter, QueryOptions } from './query'
import { eq, isIn, query } from './query'
import type { AnyRelDef, PreloadedMap } from './relations'
import { BelongsToRelation, HasManyRelation, HasOneRelation, ManyToManyRelation } from './relations'
import type { AnySchema, SchemaOutput } from './schema'
import { validateInsert, validateUpdate, type SchemaInsertInput, type SchemaUpdateInput } from './schema-validations'

type Selected<S extends AnySchema, Sel extends string> = [Sel] extends [never]
	? SchemaOutput<S>
	: Pick<SchemaOutput<S>, Sel & keyof SchemaOutput<S>>

export type Repo<A extends OrmAdapter<any>> = {
	findOne<S extends AnySchema, P extends readonly AnyRelDef[] = []>(
		schema: S,
		filter: QueryFilter,
		options?: { preloads?: P },
	): Promise<(SchemaOutput<S> & PreloadedMap<P>) | null>

	findMany<S extends AnySchema, P extends readonly AnyRelDef[] = [], Sel extends keyof SchemaOutput<S> & string = never>(
		schema: S,
		filter: QueryFilter,
		options?: QueryOptions<Sel> & { preloads?: P },
	): Promise<(Selected<S, Sel> & PreloadedMap<P>)[]>

	insertOne<S extends AnySchema, P extends readonly AnyRelDef[] = []>(
		schema: S,
		data: SchemaInsertInput<S>,
		options?: { preloads?: P },
	): Promise<SchemaOutput<S> & PreloadedMap<P>>

	insertMany<S extends AnySchema, P extends readonly AnyRelDef[] = []>(
		schema: S,
		data: SchemaInsertInput<S>[],
		options?: { preloads?: P },
	): Promise<(SchemaOutput<S> & PreloadedMap<P>)[]>

	updateOne<S extends AnySchema, P extends readonly AnyRelDef[] = []>(
		schema: S,
		filter: QueryFilter,
		data: SchemaUpdateInput<S>,
		options?: { preloads?: P },
	): Promise<(SchemaOutput<S> & PreloadedMap<P>) | null>

	updateMany<S extends AnySchema, P extends readonly AnyRelDef[] = []>(
		schema: S,
		filter: QueryFilter,
		data: SchemaUpdateInput<S>,
		options?: { preloads?: P },
	): Promise<(SchemaOutput<S> & PreloadedMap<P>)[]>

	upsertOne<S extends AnySchema>(
		schema: S,
		filter: QueryFilter,
		data: { insert: SchemaInsertInput<S> } | { insert: SchemaInsertInput<S>; update: SchemaUpdateInput<S> },
	): Promise<SchemaOutput<S>>

	deleteOne<S extends AnySchema>(schema: S, filter: QueryFilter): Promise<SchemaOutput<S> | null>

	deleteMany<S extends AnySchema>(schema: S, filter: QueryFilter): Promise<SchemaOutput<S>[]>

	paginatedQuery<S extends AnySchema>(
		schema: S,
		filter: QueryFilter,
		pagination: { page: number; limit: number },
	): Promise<PaginatedResult<SchemaOutput<S>>>

	session<T>(fn: (tx: Repo<A>) => Promise<T>): Promise<T>

	resolve<T>(resolver: (config: InferAdapterConfig<A>, schema: AnySchema) => InferAdapterConfig<A>, fn: () => Promise<T>): Promise<T>
}

export function createRepo<A extends OrmAdapter<any>>({
	adapter,
	defaults,
}: {
	adapter: A
	defaults: (schema: AnySchema) => InferAdapterConfig<A>
}): Repo<A> {
	type Config = InferAdapterConfig<A>

	const resolverStore = new AsyncLocalStorage<((config: Config, schema: AnySchema) => Config) | undefined>()

	function getConfig(s: AnySchema): Config {
		const resolver = resolverStore.getStore()
		const base = defaults(s)
		return resolver ? resolver(base, s) : base
	}

	function getUse(s: AnySchema): OrmUse {
		return adapter.use(s, getConfig(s))
	}

	const repo: Repo<A> = {
		async findOne(s, filter, options) {
			const result = await getUse(s).findOne(filter)
			if (!result) return null
			const { preloads } = options ?? {}
			if (!preloads || preloads.length === 0) return result as any
			const [resolved] = await resolvePreloads([result], [...preloads], getUse)
			return (resolved ?? null) as any
		},

		async findMany(s, filter, options) {
			const { preloads, ...queryOptions } = options ?? {}
			const results = await getUse(s).findMany(filter, queryOptions)
			const entities = results as SchemaOutput<typeof s>[]

			if (!preloads || preloads.length === 0) return entities as any

			return resolvePreloads(entities as Record<string, unknown>[], [...preloads], getUse) as any
		},

		async insertOne(s, data, options) {
			const validated = validateInsert(s, data as Record<string, unknown>)
			const result = await getUse(s).insertOne(validated as Record<string, unknown>)
			const { preloads } = options ?? {}
			if (!preloads || preloads.length === 0) return result as any
			const [resolved] = await resolvePreloads([result], [...preloads], getUse)
			return resolved as any
		},

		async insertMany(s, data, options) {
			const validated = (data as Record<string, unknown>[]).map((d) => validateInsert(s, d) as Record<string, unknown>)
			const results = await getUse(s).insertMany(validated)
			const { preloads } = options ?? {}
			if (!preloads || preloads.length === 0) return results as any
			return resolvePreloads(results, [...preloads], getUse) as any
		},

		async updateOne(s, filter, data, options) {
			const validated = validateUpdate(s, data as Record<string, unknown>)
			const result = await getUse(s).updateOne(filter, validated as Record<string, unknown>)
			if (!result) return null
			const { preloads } = options ?? {}
			if (!preloads || preloads.length === 0) return result as any
			const [resolved] = await resolvePreloads([result], [...preloads], getUse)
			return (resolved ?? null) as any
		},

		async updateMany(s, filter, data, options) {
			const validated = validateUpdate(s, data as Record<string, unknown>)
			const results = await getUse(s).updateMany(filter, validated as Record<string, unknown>)
			const { preloads } = options ?? {}
			if (!preloads || preloads.length === 0) return results as any
			return resolvePreloads(results, [...preloads], getUse) as any
		},

		async upsertOne(s, filter, data) {
			const insert = validateInsert(s, data.insert as Record<string, unknown>)
			const update = 'update' in data ? validateUpdate(s, data.update as Record<string, unknown>) : undefined
			const result = await getUse(s).upsertOne(
				filter,
				update
					? { insert: insert as Record<string, unknown>, update: update as Record<string, unknown> }
					: { insert: insert as Record<string, unknown> },
			)
			return result as SchemaOutput<typeof s>
		},

		async deleteOne(s, filter) {
			const result = await getUse(s).deleteOne(filter)
			return (result ?? null) as SchemaOutput<typeof s> | null
		},

		async deleteMany(s, filter) {
			const results = await getUse(s).deleteMany(filter)
			return results as SchemaOutput<typeof s>[]
		},

		async paginatedQuery(s, filter, pagination) {
			const result = await getUse(s).paginatedQuery(filter, { ...pagination, all: false })
			return { ...result, results: result.results as SchemaOutput<typeof s>[] }
		},

		async session(fn) {
			return adapter.session(() => fn(repo))
		},

		async resolve(resolver, fn) {
			const outerResolver = resolverStore.getStore()
			const chained = outerResolver ? (config: Config, s: AnySchema) => resolver(outerResolver(config, s), s) : resolver
			return resolverStore.run(chained, fn)
		},
	}

	return repo
}

async function resolvePreloads(entities: Record<string, unknown>[], defs: AnyRelDef[], getUse: (s: AnySchema) => OrmUse) {
	let results = entities
	for (const def of defs) {
		results = await resolvePreload(results, def, getUse)
	}
	return results
}

async function resolvePreload(
	entities: Record<string, unknown>[],
	def: AnyRelDef,
	getUse: (s: AnySchema) => OrmUse,
): Promise<Record<string, unknown>[]> {
	const { source, target, name } = def
	const sourcePk = source.pkName
	const targetPk = target.pkName

	if (def instanceof BelongsToRelation) {
		const fkValues = [...new Set(entities.map((e) => e[def.foreignKey]).filter((v) => v != null))]
		if (fkValues.length === 0) return entities.map((e) => ({ ...e, [name]: null }))

		const related = await getUse(target).findMany(query(isIn(targetPk, fkValues as string[])))
		const lookup = new Map(related.map((r) => [r[targetPk], r]))
		return entities.map((e) => ({ ...e, [name]: lookup.get(e[def.foreignKey] as any) ?? null }))
	}

	if (def instanceof HasOneRelation) {
		const pkValues = [...new Set(entities.map((e) => e[sourcePk]).filter((v) => v != null))]
		if (pkValues.length === 0) return entities.map((e) => ({ ...e, [name]: null }))

		const related = await getUse(target).findMany(query(isIn(def.foreignKey, pkValues as string[])))
		const lookup = new Map(related.map((r) => [r[def.foreignKey], r]))
		return entities.map((e) => ({ ...e, [name]: lookup.get(e[sourcePk] as any) ?? null }))
	}

	if (def instanceof HasManyRelation) {
		const pkValues = [...new Set(entities.map((e) => e[sourcePk]).filter((v) => v != null))]
		if (pkValues.length === 0) return entities.map((e) => ({ ...e, [name]: [] }))

		const related = await getUse(target).findMany(query(isIn(def.foreignKey, pkValues as string[])))
		const grouped = new Map<unknown, Record<string, unknown>[]>()
		for (const r of related) {
			const fk = r[def.foreignKey]
			if (!grouped.has(fk)) grouped.set(fk, [])
			grouped.get(fk)!.push(r)
		}
		return entities.map((e) => ({ ...e, [name]: grouped.get(e[sourcePk] as any) ?? [] }))
	}

	if (def instanceof ManyToManyRelation) {
		const pkValues = [...new Set(entities.map((e) => e[sourcePk]).filter((v) => v != null))]
		if (pkValues.length === 0) return entities.map((e) => ({ ...e, [name]: [] }))

		const joinRecords = await getUse(def.joinSchema).findMany(query(isIn(def.sourceFk, pkValues as string[])))
		if (joinRecords.length === 0) return entities.map((e) => ({ ...e, [name]: [] }))

		const targetIds = [...new Set(joinRecords.map((r) => r[def.targetFk]).filter((v) => v != null))]
		const targetRecords = await getUse(target).findMany(query(isIn(targetPk, targetIds as string[])))

		const targetLookup = new Map(targetRecords.map((r) => [r[targetPk], r]))

		const grouped = new Map<unknown, Record<string, unknown>[]>()
		for (const jr of joinRecords) {
			const related = targetLookup.get(jr[def.targetFk] as any)
			if (related) {
				if (!grouped.has(jr[def.sourceFk])) grouped.set(jr[def.sourceFk], [])
				grouped.get(jr[def.sourceFk])!.push(related)
			}
		}

		return entities.map((e) => ({ ...e, [name]: grouped.get(e[sourcePk] as any) ?? [] }))
	}

	throw new Error(`Unknown relation kind: ${(def as any).kind}`)
}

if (import.meta.vitest) {
	const { describe, test, expect, vi } = import.meta.vitest
	const { v } = await import('valleyed')
	const { Schema } = await import('./schema')
	const { Relations } = await import('./relations')
	const { OrmAdapter } = await import('./adapters/base')

	// In-memory mock adapter for testing
	function createMockAdapter<Config extends object>() {
		const stores = new Map<string, Map<string, Record<string, unknown>>>()

		const getStore = (name: string) => {
			if (!stores.has(name)) stores.set(name, new Map())
			return stores.get(name)!
		}

		class MockAdapter extends OrmAdapter<Config> {
			async connect() {}
			async disconnect() {}

			use(s: AnySchema, _config: Config): OrmUse {
				const store = getStore(s.name)

				return {
					async findMany(filter, options) {
						let results = [...store.values()]
						for (const w of filter.wheres) {
							if (w.condition === 'eq') {
								results = results.filter((r) => r[w.field] === w.value)
							} else if (w.condition === 'in') {
								results = results.filter((r) => (w.value as unknown[]).includes(r[w.field]))
							}
						}
						if (options?.limit != null) results = results.slice(0, options.limit)
						return results
					},
					async findOne(filter) {
						const results = await this.findMany(filter, { limit: 1 })
						return results[0] ?? null
					},
					async insertOne(data) {
						store.set(data[s.pkName] as string, data)
						return data
					},
					async insertMany(data) {
						return Promise.all(data.map((d) => this.insertOne(d)))
					},
					async updateMany(filter, data) {
						const results = await this.findMany(filter)
						return results.map((r) => {
							const updated = { ...r, ...data }
							store.set(r[s.pkName] as string, updated)
							return updated
						})
					},
					async updateOne(filter, data) {
						const results = await this.updateMany(filter, data)
						return results[0] ?? null
					},
					async upsertOne(_filter, data) {
						const row = { ...data.insert }
						store.set(row[s.pkName] as string, row)
						return row
					},
					async deleteOne(filter) {
						const result = await this.findMany(filter, { limit: 1 })
						if (result[0]) store.delete(result[0][s.pkName] as string)
						return result[0] ?? null
					},
					async deleteMany(filter) {
						const results = await this.findMany(filter)
						for (const r of results) store.delete(r[s.pkName] as string)
						return results
					},
					async paginatedQuery(filter, pagination) {
						const all = await this.findMany(filter)
						const total = all.length
						const { page, limit } = pagination
						const offset = (page - 1) * limit
						const results = all.slice(offset, offset + limit)
						const last = Math.ceil(total / limit) || 1
						return {
							pages: {
								current: page,
								start: 1,
								last,
								previous: page > 1 ? page - 1 : null,
								next: page < last ? page + 1 : null,
							},
							docs: { limit, total, count: results.length },
							results,
						}
					},
				}
			}

			async session<T>(fn: () => Promise<T>) {
				return fn()
			}
		}

		return { adapter: new MockAdapter() as OrmAdapter<Config>, stores }
	}

	describe('createRepo', () => {
		// Counter-based generators so multiple inserts produce unique IDs
		let userCounter = 0
		let postCounter = 0
		let profileCounter = 0
		let orgCounter = 0
		let tagCounter = 0
		let postTagCounter = 0

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

		const TagSchema = Schema.from('tags')
			.pk('id', v.string(), () => `t${++tagCounter}`)
			.field('label', v.string())

		const PostTagSchema = Schema.from('post_tags')
			.pk('id', v.string(), () => `pt${++postTagCounter}`)
			.field('postId', v.string())
			.field('tagId', v.string())

		const UserRelations = Relations.of(UserSchema)
			.hasMany('posts', PostSchema, 'userId')
			.hasOne('profile', ProfileSchema, 'userId')
			.belongsTo('org', OrgSchema, 'orgId')

		const PostRelations = Relations.of(PostSchema)
			.belongsTo('author', UserSchema, 'userId')
			.manyToMany('tags', TagSchema, PostTagSchema, 'postId', 'tagId')

		// Each test gets a fresh adapter + repo to avoid shared state
		function makeRepo() {
			const { adapter } = createMockAdapter<{ prefix: string }>()
			return createRepo({ adapter, defaults: (s) => ({ prefix: s.name }) })
		}

		test('insertOne applies schema generators and returns entity', async () => {
			const Repo = makeRepo()
			const user = await Repo.insertOne(UserSchema, { email: 'a@b.com', name: 'Alice' })
			expect(user.id).toMatch(/^u\d+$/)
			expect(user.createdAt).toBe(1000)
			expect(user.email).toBe('a@b.com')
		})

		test('findOne returns inserted entity by pk', async () => {
			const Repo = makeRepo()
			const inserted = await Repo.insertOne(UserSchema, { email: 'get@test.com' as any, name: 'Bob' as any })
			const found = await Repo.findOne(UserSchema, query(eq('id', inserted.id)))
			expect(found).not.toBeNull()
			expect(found?.id).toBe(inserted.id)
		})

		test('findMany returns all entities', async () => {
			const Repo = makeRepo()
			await Repo.insertOne(UserSchema, { email: 'a@b.com', name: 'Alice' })
			const results = await Repo.findMany(UserSchema, query())
			expect(results).toHaveLength(1)
		})

		test('updateMany modifies entity', async () => {
			const Repo = makeRepo()
			await Repo.insertOne(UserSchema, { email: 'a@b.com', name: 'Alice' })
			const updated = await Repo.updateMany(UserSchema, query(eq('name', 'Alice')), { name: 'Alice Updated' })
			expect(updated[0]?.name).toBe('Alice Updated')
		})

		test('updateOne returns updated entity', async () => {
			const Repo = makeRepo()
			const user = await Repo.insertOne(UserSchema, { email: 'a@b.com', name: 'Alice' })
			const result = await Repo.updateOne(UserSchema, query(eq('id', user.id)), { name: 'New Name' })
			expect(result?.name).toBe('New Name')
		})

		test('deleteMany removes entity and returns it', async () => {
			const Repo = makeRepo()
			await Repo.insertOne(UserSchema, { email: 'del@test.com', name: 'ToDelete' })
			const deleted = await Repo.deleteMany(UserSchema, query(eq('name', 'ToDelete')))
			expect(deleted).toHaveLength(1)
			expect(deleted[0].name).toBe('ToDelete')
		})

		test('resolve overrides config', async () => {
			const seenConfigs: unknown[] = []
			const { adapter: spyAdapter } = createMockAdapter<{ prefix: string }>()
			const origUse = spyAdapter.use.bind(spyAdapter)
			spyAdapter.use = vi.fn((s, config) => {
				seenConfigs.push(config)
				return origUse(s, config)
			})

			const SpyRepo = createRepo({ adapter: spyAdapter, defaults: (s) => ({ prefix: s.name }) })

			await SpyRepo.resolve(
				(_config, s) => ({ prefix: `tenant_${s.name}` }),
				async () => {
					await SpyRepo.findMany(UserSchema, query())
				},
			)

			expect(seenConfigs[0]).toEqual({ prefix: 'tenant_users' })
		})

		test('nested resolve chains — inner receives outer output', async () => {
			const seenConfigs: unknown[] = []
			const { adapter: spyAdapter } = createMockAdapter<{ prefix: string }>()
			const origUse = spyAdapter.use.bind(spyAdapter)
			spyAdapter.use = vi.fn((s, config) => {
				seenConfigs.push(config)
				return origUse(s, config)
			})

			const SpyRepo = createRepo({ adapter: spyAdapter, defaults: (s) => ({ prefix: s.name }) })

			await SpyRepo.resolve(
				(config) => ({ prefix: `a_${config.prefix}` }),
				async () => {
					await SpyRepo.resolve(
						(config) => ({ prefix: `b_${config.prefix}` }),
						async () => {
							await SpyRepo.findMany(UserSchema, query())
						},
					)
				},
			)

			// inner resolver receives outer output: a_users → b_a_users
			expect(seenConfigs[0]).toEqual({ prefix: 'b_a_users' })
		})

		test('preload hasMany resolves related entities', async () => {
			const Repo = makeRepo()
			const user = await Repo.insertOne(UserSchema, { email: 'u@test.com', name: 'User' })
			await Repo.insertOne(PostSchema, { title: 'Post 1', userId: user.id })
			await Repo.insertOne(PostSchema, { title: 'Post 2', userId: user.id })

			const users = await Repo.findMany(UserSchema, query(), { preloads: [UserRelations.definitions.posts] as const })
			expect(users[0].posts).toHaveLength(2)
			expect(users[0].posts[0].title).toBeDefined()
		})

		// ── insertMany ────────────────────────────────────────────────────────
		test('insertMany inserts all entities and returns them', async () => {
			const Repo = makeRepo()
			const users = await Repo.insertMany(UserSchema, [
				{ email: 'a@b.com', name: 'Alice' },
				{ email: 'b@c.com', name: 'Bob' },
			])
			expect(users).toHaveLength(2)
			expect(users[0].name).toBe('Alice')
			expect(users[1].name).toBe('Bob')
			expect(users[0].createdAt).toBe(1000)
		})

		// ── findOne ───────────────────────────────────────────────────────────
		test('findOne returns null when no entity matches', async () => {
			const Repo = makeRepo()
			const result = await Repo.findOne(UserSchema, query(eq('id', 'nonexistent')))
			expect(result).toBeNull()
		})

		// ── findMany ──────────────────────────────────────────────────────────
		test('findMany filters by eq condition', async () => {
			const Repo = makeRepo()
			await Repo.insertOne(UserSchema, { email: 'a@b.com', name: 'Alice' })
			await Repo.insertOne(UserSchema, { email: 'b@c.com', name: 'Bob' })
			const results = await Repo.findMany(UserSchema, query(eq('name', 'Alice')))
			expect(results).toHaveLength(1)
			expect(results[0].name).toBe('Alice')
		})

		test('findMany with limit option returns at most N results', async () => {
			const Repo = makeRepo()
			await Repo.insertOne(UserSchema, { email: 'a@b.com', name: 'Alice' })
			await Repo.insertOne(UserSchema, { email: 'b@c.com', name: 'Bob' })
			const results = await Repo.findMany(UserSchema, query(), { limit: 1 })
			expect(results).toHaveLength(1)
		})

		test('findMany with empty filter returns all entities', async () => {
			const Repo = makeRepo()
			await Repo.insertMany(UserSchema, [
				{ email: 'a@b.com', name: 'Alice' },
				{ email: 'b@c.com', name: 'Bob' },
				{ email: 'c@d.com', name: 'Carol' },
			])
			expect(await Repo.findMany(UserSchema, query())).toHaveLength(3)
		})

		// ── updateOne ─────────────────────────────────────────────────────────
		test('updateOne returns null when no entity matches', async () => {
			const Repo = makeRepo()
			const result = await Repo.updateOne(UserSchema, query(eq('id', 'missing')), { name: 'X' })
			expect(result).toBeNull()
		})

		// ── upsertOne ─────────────────────────────────────────────────────────
		test('upsertOne inserts and returns entity', async () => {
			const Repo = makeRepo()
			const user = await Repo.upsertOne(UserSchema, query(eq('id', 'u-fixed')), {
				insert: { email: 'new@test.com', name: 'New' },
			})
			expect(user.name).toBe('New')
			expect(user.email).toBe('new@test.com')
		})

		test('upsertOne with insert+update data runs without error', async () => {
			const Repo = makeRepo()
			const user = await Repo.upsertOne(UserSchema, query(eq('id', 'u-up')), {
				insert: { email: 'up@test.com', name: 'UpUser' },
				update: { name: 'Updated' },
			})
			expect(user).toBeDefined()
		})

		// ── deleteOne ─────────────────────────────────────────────────────────
		test('deleteOne removes entity and returns it', async () => {
			const Repo = makeRepo()
			const user = await Repo.insertOne(UserSchema, { email: 'del@test.com', name: 'ToDelete' })
			const deleted = await Repo.deleteOne(UserSchema, query(eq('id', user.id)))
			expect(deleted?.id).toBe(user.id)
			expect(await Repo.findOne(UserSchema, query(eq('id', user.id)))).toBeNull()
		})

		test('deleteOne returns null when entity not found', async () => {
			const Repo = makeRepo()
			expect(await Repo.deleteOne(UserSchema, query(eq('id', 'nonexistent')))).toBeNull()
		})

		// ── paginatedQuery ────────────────────────────────────────────────────
		test('paginatedQuery page 1 returns correct structure', async () => {
			const Repo = makeRepo()
			await Repo.insertMany(UserSchema, [
				{ email: 'a@b.com', name: 'Alice' },
				{ email: 'b@c.com', name: 'Bob' },
				{ email: 'c@d.com', name: 'Carol' },
			])
			const page = await Repo.paginatedQuery(UserSchema, query(), { page: 1, limit: 2 })
			expect(page.docs.total).toBe(3)
			expect(page.docs.count).toBe(2)
			expect(page.results).toHaveLength(2)
			expect(page.pages.current).toBe(1)
			expect(page.pages.last).toBe(2)
			expect(page.pages.next).toBe(2)
			expect(page.pages.previous).toBeNull()
		})

		test('paginatedQuery last page has no next', async () => {
			const Repo = makeRepo()
			await Repo.insertMany(UserSchema, [
				{ email: 'a@b.com', name: 'Alice' },
				{ email: 'b@c.com', name: 'Bob' },
				{ email: 'c@d.com', name: 'Carol' },
			])
			const page = await Repo.paginatedQuery(UserSchema, query(), { page: 2, limit: 2 })
			expect(page.results).toHaveLength(1)
			expect(page.pages.next).toBeNull()
			expect(page.pages.previous).toBe(1)
		})

		// ── session ───────────────────────────────────────────────────────────
		test('session executes callback and returns result', async () => {
			const Repo = makeRepo()
			const result = await Repo.session(async () => 42 as any)
			expect(result).toBe(42)
		})

		test('session makes inserts visible after completion', async () => {
			const Repo = makeRepo()
			let inserted: any
			await Repo.session(async (tx) => {
				inserted = await tx.insertOne(UserSchema, { email: 't@test.com', name: 'TxUser' })
			})
			expect(await Repo.findOne(UserSchema, query(eq('id', inserted.id)))).not.toBeNull()
		})

		// ── preload: hasOne ───────────────────────────────────────────────────
		test('preload hasOne resolves related entity', async () => {
			const Repo = makeRepo()
			const user = await Repo.insertOne(UserSchema, { email: 'u@test.com', name: 'User' })
			await Repo.insertOne(ProfileSchema, { bio: 'Hello', userId: user.id })

			const users = await Repo.findMany(UserSchema, query(), {
				preloads: [UserRelations.definitions.profile] as const,
			})
			expect(users[0].profile).not.toBeNull()
			expect((users[0].profile as any).bio).toBe('Hello')
		})

		test('preload hasOne returns null when no related entity', async () => {
			const Repo = makeRepo()
			await Repo.insertOne(UserSchema, { email: 'u@test.com', name: 'User' })

			const users = await Repo.findMany(UserSchema, query(), {
				preloads: [UserRelations.definitions.profile] as const,
			})
			expect(users[0].profile).toBeNull()
		})

		// ── preload: belongsTo ────────────────────────────────────────────────
		test('preload belongsTo resolves related entity', async () => {
			const Repo = makeRepo()
			const org = await Repo.insertOne(OrgSchema, { name: 'ACME' })
			await Repo.insertOne(UserSchema, { email: 'u@test.com', name: 'User', orgId: org.id })

			const users = await Repo.findMany(UserSchema, query(), {
				preloads: [UserRelations.definitions.org] as const,
			})
			expect(users[0].org).not.toBeNull()
			expect((users[0].org as any).name).toBe('ACME')
		})

		test('preload belongsTo returns null when fk is unset', async () => {
			const Repo = makeRepo()
			await Repo.insertOne(UserSchema, { email: 'u@test.com', name: 'User' })

			const users = await Repo.findMany(UserSchema, query(), {
				preloads: [UserRelations.definitions.org] as const,
			})
			expect(users[0].org).toBeNull()
		})

		// ── preload: manyToMany ───────────────────────────────────────────────
		test('preload manyToMany resolves related entities through join table', async () => {
			const Repo = makeRepo()
			const post = await Repo.insertOne(PostSchema, { title: 'My Post', userId: 'u1' })
			const tag1 = await Repo.insertOne(TagSchema, { label: 'ts' })
			const tag2 = await Repo.insertOne(TagSchema, { label: 'orm' })
			await Repo.insertOne(PostTagSchema, { postId: post.id, tagId: tag1.id })
			await Repo.insertOne(PostTagSchema, { postId: post.id, tagId: tag2.id })

			const posts = await Repo.findMany(PostSchema, query(), {
				preloads: [PostRelations.definitions.tags] as const,
			})
			expect(posts[0].tags).toHaveLength(2)
			expect((posts[0].tags as any[]).map((t) => t.label).sort()).toEqual(['orm', 'ts'])
		})

		test('preload manyToMany returns empty array when no join records', async () => {
			const Repo = makeRepo()
			await Repo.insertOne(PostSchema, { title: 'No Tags', userId: 'u1' })

			const posts = await Repo.findMany(PostSchema, query(), {
				preloads: [PostRelations.definitions.tags] as const,
			})
			expect(posts[0].tags).toEqual([])
		})

		// ── preload on mutation methods ───────────────────────────────────────
		test('findOne with preloads resolves relations', async () => {
			const Repo = makeRepo()
			const user = await Repo.insertOne(UserSchema, { email: 'u@test.com', name: 'User' })
			await Repo.insertOne(PostSchema, { title: 'Post', userId: user.id })

			const found = await Repo.findOne(UserSchema, query(eq('id', user.id)), {
				preloads: [UserRelations.definitions.posts] as const,
			})
			expect(found?.posts).toHaveLength(1)
		})

		test('insertOne with preloads resolves relations on result', async () => {
			const Repo = makeRepo()
			const org = await Repo.insertOne(OrgSchema, { name: 'Corp' })
			const user = await Repo.insertOne(
				UserSchema,
				{ email: 'u@test.com', name: 'User', orgId: org.id },
				{ preloads: [UserRelations.definitions.org] as const },
			)
			expect((user.org as any).name).toBe('Corp')
		})

		test('updateOne with preloads resolves relations on result', async () => {
			const Repo = makeRepo()
			const user = await Repo.insertOne(UserSchema, { email: 'u@test.com', name: 'User' })
			await Repo.insertOne(PostSchema, { title: 'Post', userId: user.id })

			const updated = await Repo.updateOne(
				UserSchema,
				query(eq('id', user.id)),
				{ name: 'Updated' },
				{ preloads: [UserRelations.definitions.posts] as const },
			)
			expect(updated?.posts).toHaveLength(1)
			expect(updated?.name).toBe('Updated')
		})
	})
}
