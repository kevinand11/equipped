import { EquippedError } from '../../../errors'
import type { OrmUse } from '../../adapters/base'
import { QueryGroup } from '../../query'
import type { AnyPreloadDef, AnyRelDef, NestedPreloadDef } from '../../relations'
import { ManyRelation, OneRelation } from '../../relations'
import type { AnySchema } from '../../schema'

const MAX_PRELOAD_DEPTH = 5

type ResolvedPreloadDef = {
	def: AnyRelDef
	preloads: ResolvedPreloadDef[]
}

function isNestedPreloadDef(def: AnyPreloadDef): def is NestedPreloadDef {
	return typeof def === 'object' && def != null && 'def' in def
}

function relationStep(def: AnyRelDef) {
	return `${def.source.name}.${def.name}->${def.target.name}`
}

function uniqueDefinedValues(entities: readonly Record<string, unknown>[], key: string) {
	return [...new Set(entities.map((entity) => entity[key]).filter((value) => value != null))]
}

function attachOneRelation(
	entities: readonly Record<string, unknown>[],
	name: string,
	lookupKey: string,
	lookup: ReadonlyMap<unknown, Record<string, unknown>>,
) {
	return entities.map((entity) => ({ ...entity, [name]: lookup.get(entity[lookupKey]) ?? null }))
}

function attachManyRelation(
	entities: readonly Record<string, unknown>[],
	name: string,
	lookupKey: string,
	lookup: ReadonlyMap<unknown, Record<string, unknown>[]>,
) {
	return entities.map((entity) => ({ ...entity, [name]: lookup.get(entity[lookupKey]) ?? [] }))
}

function normalizePreloads(defs: readonly AnyPreloadDef[]): ResolvedPreloadDef[] {
	return defs.map((def) => {
		if (def instanceof ManyRelation || def instanceof OneRelation) {
			return { def, preloads: [] }
		}

		if (!isNestedPreloadDef(def) || !(def.def instanceof ManyRelation || def.def instanceof OneRelation)) {
			throw new Error('Invalid preload definition: nested preloads must include a relation definition in `def`')
		}

		return {
			def: def.def,
			preloads: normalizePreloads(def.preloads ?? []),
		}
	})
}

export async function resolvePreloads<T extends Record<string, unknown>>(
	entities: T[],
	defs: readonly AnyPreloadDef[],
	getUse: (s: AnySchema) => OrmUse,
) {
	return resolvePreloadNodes(entities, normalizePreloads(defs), getUse, 1, []) as unknown as T[]
}

async function resolvePreloadNodes(
	entities: Record<string, unknown>[],
	defs: readonly ResolvedPreloadDef[],
	getUse: (s: AnySchema) => OrmUse,
	depth: number,
	path: readonly string[],
) {
	for (const def of defs) entities = await resolvePreload(entities, def, getUse, depth, path)
	return entities
}

async function resolvePreload(
	entities: Record<string, unknown>[],
	node: ResolvedPreloadDef,
	getUse: (s: AnySchema) => OrmUse,
	depth: number,
	path: readonly string[],
): Promise<Record<string, unknown>[]> {
	if (depth > MAX_PRELOAD_DEPTH) {
		throw new EquippedError(`Preload depth exceeded max depth ${MAX_PRELOAD_DEPTH}`, {
			operation: 'resolvePreload',
			depth,
			maxDepth: MAX_PRELOAD_DEPTH,
		})
	}

	const { def } = node
	const { target, name } = def
	const step = relationStep(def)
	if (path.includes(step)) {
		throw new EquippedError(`Preload cycle detected: ${[...path, step].join(' -> ')}`, {
			operation: 'resolvePreload',
			path,
			step,
		})
	}
	const nextPath = [...path, step]

	if (def instanceof OneRelation) {
		if (def.fkOwner === 'source') {
			const refCol = def.references.name
			const fkValues = uniqueDefinedValues(entities, def.foreignKey.name)
			if (fkValues.length === 0) return entities.map((e) => ({ ...e, [name]: null }))

			let related = await getUse(target).findMany(QueryGroup.from().in(refCol, fkValues))
			if (node.preloads.length > 0 && related.length > 0) {
				related = await resolvePreloadNodes(related, node.preloads, getUse, depth + 1, nextPath)
			}
			const lookup = new Map(related.map((r) => [r[refCol], r]))
			return attachOneRelation(entities, name, def.foreignKey.name, lookup)
		}

		const refCol = def.references.name
		const refValues = uniqueDefinedValues(entities, refCol)
		if (refValues.length === 0) return entities.map((e) => ({ ...e, [name]: null }))

		let related = await getUse(target).findMany(QueryGroup.from().in(def.foreignKey, refValues))
		if (node.preloads.length > 0 && related.length > 0) {
			related = await resolvePreloadNodes(related, node.preloads, getUse, depth + 1, nextPath)
		}
		const lookup = new Map(related.map((r) => [r[def.foreignKey.name], r]))
		return attachOneRelation(entities, name, refCol, lookup)
	}

	if (def instanceof ManyRelation) {
		const refCol = def.references.name
		const refValues = uniqueDefinedValues(entities, refCol)
		if (refValues.length === 0) return entities.map((e) => ({ ...e, [name]: [] }))

		let related = await getUse(target).findMany(QueryGroup.from().in(def.foreignKey, refValues))
		if (node.preloads.length > 0 && related.length > 0) {
			related = await resolvePreloadNodes(related, node.preloads, getUse, depth + 1, nextPath)
		}

		const grouped = new Map<unknown, Record<string, unknown>[]>()
		for (const r of related) {
			const fk = r[def.foreignKey.name]
			if (!grouped.has(fk)) grouped.set(fk, [])
			grouped.get(fk)!.push(r)
		}
		return attachManyRelation(entities, name, refCol, grouped)
	}

	throw new Error(`Unknown relation kind: ${String(Reflect.get(def as object, 'kind'))}; expected OneRelation or ManyRelation`)
}

if (import.meta.vitest) {
	const { describe, test, expect } = import.meta.vitest
	const { v } = await import('valleyed')
	const { createInMemoryAdapter } = await import('../../adapters/in-memory')
	const { defineRelations } = await import('../../relations')
	const { defineRepo } = await import('../repo')
	const { defineSchema } = await import('../../schema')

	describe('repo preload resolution', () => {
		let userCounter = 0
		let postCounter = 0
		let profileCounter = 0
		let orgCounter = 0
		let aCounter = 0
		let bCounter = 0
		let cCounter = 0
		let dCounter = 0
		let eCounter = 0
		let fCounter = 0
		let gCounter = 0

		const UserSchema = defineSchema('users', (s) =>
			s.pk('id', v.string(), () => `u${++userCounter}`)
			 .field('email', v.string())
			 .field('name', v.string())
			 .field('orgId', v.optional(v.string()), { onCreate: () => undefined }),
		)

		const PostSchema = defineSchema('posts', (s) =>
			s.pk('id', v.string(), () => `p${++postCounter}`)
			 .field('title', v.string())
			 .field('userId', v.string()),
		)

		const ProfileSchema = defineSchema('profiles', (s) =>
			s.pk('id', v.string(), () => `pr${++profileCounter}`)
			 .field('bio', v.string())
			 .field('userId', v.string()),
		)

		const OrgSchema = defineSchema('orgs', (s) =>
			s.pk('id', v.string(), () => `o${++orgCounter}`)
			 .field('name', v.string()),
		)

		const ASchema = defineSchema('as', (s) =>
			s.pk('id', v.string(), () => `a${++aCounter}`),
		)
		const BSchema = defineSchema('bs', (s) =>
			s.pk('id', v.string(), () => `b${++bCounter}`)
			 .field('aId', v.string()),
		)
		const CSchema = defineSchema('cs', (s) =>
			s.pk('id', v.string(), () => `c${++cCounter}`)
			 .field('bId', v.string()),
		)
		const DSchema = defineSchema('ds', (s) =>
			s.pk('id', v.string(), () => `d${++dCounter}`)
			 .field('cId', v.string()),
		)
		const ESchema = defineSchema('es', (s) =>
			s.pk('id', v.string(), () => `e${++eCounter}`)
			 .field('dId', v.string()),
		)
		const FSchema = defineSchema('fs', (s) =>
			s.pk('id', v.string(), () => `f${++fCounter}`)
			 .field('eId', v.string()),
		)
		const GSchema = defineSchema('gs', (s) =>
			s.pk('id', v.string(), () => `g${++gCounter}`)
			 .field('fId', v.string()),
		)

		const UserRels = defineRelations(UserSchema, (rel, src) => rel
			.hasMany('posts', PostSchema.fields.userId)
			.hasOne('profile', ProfileSchema.fields.userId)
			.belongsTo('org', src.fields.orgId, OrgSchema),
		)

		const PostRels = defineRelations(PostSchema, (rel, src) => rel
			.belongsTo('author', src.fields.userId, UserSchema),
		)

		const ARels = defineRelations(ASchema, (rel) => rel.hasMany('bs', BSchema.fields.aId))
		const BRels = defineRelations(BSchema, (rel) => rel.hasMany('cs', CSchema.fields.bId))
		const CRels = defineRelations(CSchema, (rel) => rel.hasMany('ds', DSchema.fields.cId))
		const DRels = defineRelations(DSchema, (rel) => rel.hasMany('es', ESchema.fields.dId))
		const ERels = defineRelations(ESchema, (rel) => rel.hasMany('fs', FSchema.fields.eId))
		const FRels = defineRelations(FSchema, (rel) => rel.hasMany('gs', GSchema.fields.fId))

		function makeRepo() {
			const { adapter } = createInMemoryAdapter()
			return defineRepo((r) => r.adapter(adapter).resolve((s) => ({ prefix: s.name })))
		}

		test('hasMany preload resolves related entities', async () => {
			const Repo = makeRepo()
			const user = await Repo.from(UserSchema).one().insert({ email: 'u@test.com', name: 'User' })
			await Repo.from(PostSchema).one().insert({ title: 'Post 1', userId: user.id })
			await Repo.from(PostSchema).one().insert({ title: 'Post 2', userId: user.id })

			const users = await Repo.from(UserSchema).all().preload([UserRels.posts]).find()
			expect(users[0].posts).toHaveLength(2)
		})

		test('hasOne and belongsTo preloads resolve null and non-null branches', async () => {
			const Repo = makeRepo()
			const user = await Repo.from(UserSchema).one().insert({ email: 'x@test.com', name: 'X' })
			await Repo.from(ProfileSchema).one().insert({ bio: 'Hello', userId: user.id })

			const users = await Repo.from(UserSchema).all().preload([UserRels.profile]).find()
			expect(users[0].profile?.bio).toBe('Hello')

			const usersWithoutOrg = await Repo.from(UserSchema).all().preload([UserRels.org]).find()
			expect(usersWithoutOrg[0].org).toBeNull()
		})

		test('nested preload resolves recursively', async () => {
			const Repo = makeRepo()
			const user = await Repo.from(UserSchema).one().insert({ email: 'nested@test.com', name: 'Nested User' })
			await Repo.from(ProfileSchema).one().insert({ bio: 'Hello nested', userId: user.id })
			await Repo.from(PostSchema).one().insert({ title: 'Nested Post', userId: user.id })

			const users = await Repo.from(UserSchema)
				.all()
				.preload([
					{
						def: UserRels.posts,
						preloads: [{ def: PostRels.author, preloads: [UserRels.profile] }],
					},
				])
				.find()

			const author = users[0].posts[0].author
			const profile = author?.profile
			expect(author?.id).toBe(user.id)
			expect(profile?.bio).toBe('Hello nested')
		})

		test('cycle detection throws descriptive error', async () => {
			const Repo = makeRepo()
			const user = await Repo.from(UserSchema).one().insert({ email: 'cycle@test.com', name: 'Cycle User' })
			await Repo.from(PostSchema).one().insert({ title: 'Cycle Post', userId: user.id })

			await expect(
				Repo.from(UserSchema)
					.all()
					.preload([
						{
							def: UserRels.posts,
							preloads: [{ def: PostRels.author, preloads: [UserRels.posts] }],
						},
					])
					.find(),
			).rejects.toThrow(/Preload cycle detected/)
		})

		test('depth limit throws when chain exceeds max depth', async () => {
			const Repo = makeRepo()
			const a = await Repo.from(ASchema).one().insert({})
			const b = await Repo.from(BSchema).one().insert({ aId: a.id })
			const c = await Repo.from(CSchema).one().insert({ bId: b.id })
			const d = await Repo.from(DSchema).one().insert({ cId: c.id })
			const e = await Repo.from(ESchema).one().insert({ dId: d.id })
			const f = await Repo.from(FSchema).one().insert({ eId: e.id })
			await Repo.from(GSchema).one().insert({ fId: f.id })

			await expect(
				Repo.from(ASchema)
					.all()
					.preload([
						{
							def: ARels.bs,
							preloads: [
								{
									def: BRels.cs,
									preloads: [
										{
											def: CRels.ds,
											preloads: [
												{
													def: DRels.es,
													preloads: [
														{
															def: ERels.fs,
															preloads: [FRels.gs],
														},
													],
												},
											],
										},
									],
								},
							],
						},
					])
					.find(),
			).rejects.toThrow(/Preload depth exceeded/)
		})

		test('invalid nested preload definition throws a validation error', async () => {
			const Repo = makeRepo()
			await Repo.from(UserSchema).one().insert({ email: 'u@test.com', name: 'User' })

			await expect(
				Repo.from(UserSchema)
					.all()
					.preload([{ def: {} as any }])
					.find(),
			).rejects.toThrow(/Invalid preload definition/)
		})

		test('findOne with preloads resolves relations', async () => {
			const Repo = makeRepo()
			const user = await Repo.from(UserSchema).one().insert({ email: 'u@test.com', name: 'User' })
			await Repo.from(PostSchema).one().insert({ title: 'Post', userId: user.id })

			const found = await Repo.from(UserSchema).one().id(user.id).preload([UserRels.posts]).find()
			expect(found?.posts).toHaveLength(1)
		})

		test('N+1 avoidance: N parents + children loaded in 2 queries, not N+1', async () => {
			const { vi } = await import('vitest')
			const { adapter } = createInMemoryAdapter()
			let queryCount = 0
			const origUse = adapter.use.bind(adapter)
			;(adapter as any).use = vi.fn((schema: any, config: any) => {
				const use = origUse(schema, config)
				return {
					...use,
					findMany: async (...args: any[]) => {
						queryCount++
						return use.findMany(...(args as [any, any]))
					},
				}
			})

			const Repo = defineRepo((r) => r.adapter(adapter).resolve((s) => ({ prefix: s.name })))
			const u1 = await Repo.from(UserSchema).one().insert({ email: 'a@test.com', name: 'A' })
			const u2 = await Repo.from(UserSchema).one().insert({ email: 'b@test.com', name: 'B' })
			const u3 = await Repo.from(UserSchema).one().insert({ email: 'c@test.com', name: 'C' })
			await Repo.from(PostSchema).one().insert({ title: 'P1', userId: u1.id })
			await Repo.from(PostSchema).one().insert({ title: 'P2', userId: u1.id })
			await Repo.from(PostSchema).one().insert({ title: 'P3', userId: u2.id })
			await Repo.from(PostSchema).one().insert({ title: 'P4', userId: u3.id })

			queryCount = 0
			const users = await Repo.from(UserSchema).all().preload([UserRels.posts]).find()

			expect(users).toHaveLength(3)
			expect(users.find((u) => u.id === u1.id)!.posts).toHaveLength(2)
			expect(users.find((u) => u.id === u2.id)!.posts).toHaveLength(1)
			expect(users.find((u) => u.id === u3.id)!.posts).toHaveLength(1)
			expect(queryCount).toBe(2)
		})
	})
}
