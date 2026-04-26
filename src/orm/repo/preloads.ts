import { EquippedError } from '../../errors'
import type { OrmUse } from '../adapters/base'
import { isIn, query } from '../query'
import type { AnyPreloadDef, AnyRelDef, NestedPreloadDef } from '../relations'
import { ManyRelation, OneRelation } from '../relations'
import type { AnySchema } from '../schema'

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

export async function resolvePreloads(
	entities: Record<string, unknown>[],
	defs: readonly AnyPreloadDef[],
	getUse: (s: AnySchema) => OrmUse,
) {
	return resolvePreloadNodes(entities, normalizePreloads(defs), getUse, 1, [])
}

async function resolvePreloadNodes(
	entities: Record<string, unknown>[],
	defs: readonly ResolvedPreloadDef[],
	getUse: (s: AnySchema) => OrmUse,
	depth: number,
	path: readonly string[],
) {
	let results = entities
	for (const def of defs) {
		results = await resolvePreload(results, def, getUse, depth, path)
	}
	return results
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
			const fkValues = [...new Set(entities.map((e) => e[def.foreignKey.name]).filter((v) => v != null))]
			if (fkValues.length === 0) return entities.map((e) => ({ ...e, [name]: null }))

			let related = (await getUse(target).findMany(query(isIn(refCol, fkValues as string[])))) as Record<string, unknown>[]
			if (node.preloads.length > 0 && related.length > 0) {
				related = await resolvePreloadNodes(related, node.preloads, getUse, depth + 1, nextPath)
			}
			const lookup = new Map(related.map((r) => [r[refCol], r]))
			return entities.map((e) => ({ ...e, [name]: lookup.get(e[def.foreignKey.name] as any) ?? null }))
		}

		const refCol = def.references.name
		const refValues = [...new Set(entities.map((e) => e[refCol]).filter((v) => v != null))]
		if (refValues.length === 0) return entities.map((e) => ({ ...e, [name]: null }))

		let related = (await getUse(target).findMany(query(isIn(def.foreignKey, refValues as string[])))) as Record<string, unknown>[]
		if (node.preloads.length > 0 && related.length > 0) {
			related = await resolvePreloadNodes(related, node.preloads, getUse, depth + 1, nextPath)
		}
		const lookup = new Map(related.map((r) => [r[def.foreignKey.name], r]))
		return entities.map((e) => ({ ...e, [name]: lookup.get(e[refCol] as any) ?? null }))
	}

	if (def instanceof ManyRelation) {
		const refCol = def.references.name
		const refValues = [...new Set(entities.map((e) => e[refCol]).filter((v) => v != null))]
		if (refValues.length === 0) return entities.map((e) => ({ ...e, [name]: [] }))

		let related = (await getUse(target).findMany(query(isIn(def.foreignKey, refValues as string[])))) as Record<string, unknown>[]
		if (node.preloads.length > 0 && related.length > 0) {
			related = await resolvePreloadNodes(related, node.preloads, getUse, depth + 1, nextPath)
		}

		const grouped = new Map<unknown, Record<string, unknown>[]>()
		for (const r of related) {
			const fk = r[def.foreignKey.name]
			if (!grouped.has(fk)) grouped.set(fk, [])
			grouped.get(fk)!.push(r)
		}
		return entities.map((e) => ({ ...e, [name]: grouped.get(e[refCol] as any) ?? [] }))
	}

	throw new Error(`Unknown relation kind: ${(def as any).kind}; expected OneRelation or ManyRelation`)
}

if (import.meta.vitest) {
	const { describe, test, expect } = import.meta.vitest
	const { v } = await import('valleyed')
	const { InMemoryOrm } = await import('../adapters/in-memory')
	const { eq, query } = await import('../query')
	const { Relations } = await import('../relations')
	const { Repo } = await import('./repo')
	const { Schema } = await import('../schema')

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

		const UserSchema = Schema.from('users')
			.pk('id', v.string(), () => `u${++userCounter}`)
			.field('email', v.string())
			.field('name', v.string())
			.field('orgId', v.optional(v.string()), { onCreate: () => undefined })

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

		const ASchema = Schema.from('as').pk('id', v.string(), () => `a${++aCounter}`)
		const BSchema = Schema.from('bs')
			.pk('id', v.string(), () => `b${++bCounter}`)
			.field('aId', v.string())
		const CSchema = Schema.from('cs')
			.pk('id', v.string(), () => `c${++cCounter}`)
			.field('bId', v.string())
		const DSchema = Schema.from('ds')
			.pk('id', v.string(), () => `d${++dCounter}`)
			.field('cId', v.string())
		const ESchema = Schema.from('es')
			.pk('id', v.string(), () => `e${++eCounter}`)
			.field('dId', v.string())
		const FSchema = Schema.from('fs')
			.pk('id', v.string(), () => `f${++fCounter}`)
			.field('eId', v.string())
		const GSchema = Schema.from('gs')
			.pk('id', v.string(), () => `g${++gCounter}`)
			.field('fId', v.string())

		const UserRelations = Relations.of(UserSchema)
			.hasMany('posts', PostSchema, 'userId')
			.hasOne('profile', ProfileSchema, 'userId')
			.belongsTo('org', OrgSchema, 'orgId')

		const PostRelations = Relations.of(PostSchema).belongsTo('author', UserSchema, 'userId')

		const ARelations = Relations.of(ASchema).hasMany('bs', BSchema, 'aId')
		const BRelations = Relations.of(BSchema).hasMany('cs', CSchema, 'bId')
		const CRelations = Relations.of(CSchema).hasMany('ds', DSchema, 'cId')
		const DRelations = Relations.of(DSchema).hasMany('es', ESchema, 'dId')
		const ERelations = Relations.of(ESchema).hasMany('fs', FSchema, 'eId')
		const FRelations = Relations.of(FSchema).hasMany('gs', GSchema, 'fId')

		function makeRepo() {
			const adapter = new InMemoryOrm()
			return Repo.from({ adapter, defaults: (s) => ({ prefix: s.name }) })
		}

		test('hasMany preload resolves related entities', async () => {
			const Repo = makeRepo()
			const user = await Repo.insertOne(UserSchema, { email: 'u@test.com', name: 'User' })
			await Repo.insertOne(PostSchema, { title: 'Post 1', userId: user.id })
			await Repo.insertOne(PostSchema, { title: 'Post 2', userId: user.id })

			const users = await Repo.findMany(UserSchema, query(), { preloads: [UserRelations.definitions.posts] })
			expect(users[0].posts).toHaveLength(2)
		})

		test('hasOne and belongsTo preloads resolve null and non-null branches', async () => {
			const Repo = makeRepo()
			const user = await Repo.insertOne(UserSchema, { email: 'x@test.com', name: 'X' })
			await Repo.insertOne(ProfileSchema, { bio: 'Hello', userId: user.id })

			const users = await Repo.findMany(UserSchema, query(), { preloads: [UserRelations.definitions.profile] })
			expect((users[0].profile as any).bio).toBe('Hello')

			const usersWithoutOrg = await Repo.findMany(UserSchema, query(), { preloads: [UserRelations.definitions.org] })
			expect(usersWithoutOrg[0].org).toBeNull()
		})

		test('nested preload resolves recursively', async () => {
			const Repo = makeRepo()
			const user = await Repo.insertOne(UserSchema, { email: 'nested@test.com', name: 'Nested User' })
			await Repo.insertOne(ProfileSchema, { bio: 'Hello nested', userId: user.id })
			await Repo.insertOne(PostSchema, { title: 'Nested Post', userId: user.id })

			const users = await Repo.findMany(UserSchema, query(), {
				preloads: [
					{
						def: UserRelations.definitions.posts,
						preloads: [{ def: PostRelations.definitions.author, preloads: [UserRelations.definitions.profile] }],
					},
				],
			})

			const author = Array.isArray(users[0].posts[0].author) ? users[0].posts[0].author[0] : users[0].posts[0].author
			const profile = author && Array.isArray((author as any).profile) ? (author as any).profile[0] : (author as any)?.profile
			expect(author?.id).toBe(user.id)
			expect(profile?.bio).toBe('Hello nested')
		})

		test('cycle detection throws descriptive error', async () => {
			const Repo = makeRepo()
			const user = await Repo.insertOne(UserSchema, { email: 'cycle@test.com', name: 'Cycle User' })
			await Repo.insertOne(PostSchema, { title: 'Cycle Post', userId: user.id })

			await expect(
				Repo.findMany(UserSchema, query(), {
					preloads: [
						{
							def: UserRelations.definitions.posts,
							preloads: [{ def: PostRelations.definitions.author, preloads: [UserRelations.definitions.posts] }],
						},
					],
				}),
			).rejects.toThrow(/Preload cycle detected/)
		})

		test('depth limit throws when chain exceeds max depth', async () => {
			const Repo = makeRepo()
			const a = await Repo.insertOne(ASchema, {})
			const b = await Repo.insertOne(BSchema, { aId: a.id })
			const c = await Repo.insertOne(CSchema, { bId: b.id })
			const d = await Repo.insertOne(DSchema, { cId: c.id })
			const e = await Repo.insertOne(ESchema, { dId: d.id })
			const f = await Repo.insertOne(FSchema, { eId: e.id })
			await Repo.insertOne(GSchema, { fId: f.id })

			await expect(
				Repo.findMany(ASchema, query(), {
					preloads: [
						{
							def: ARelations.definitions.bs,
							preloads: [
								{
									def: BRelations.definitions.cs,
									preloads: [
										{
											def: CRelations.definitions.ds,
											preloads: [
												{
													def: DRelations.definitions.es,
													preloads: [
														{
															def: ERelations.definitions.fs,
															preloads: [FRelations.definitions.gs],
														},
													],
												},
											],
										},
									],
								},
							],
						},
					],
				}),
			).rejects.toThrow(/Preload depth exceeded/)
		})

		test('invalid nested preload definition throws a validation error', async () => {
			const Repo = makeRepo()
			await Repo.insertOne(UserSchema, { email: 'u@test.com', name: 'User' })

			await expect(
				Repo.findMany(UserSchema, query(), {
					preloads: [{ def: {} as any }],
				}),
			).rejects.toThrow(/Invalid preload definition/)
		})

		test('findOne with preloads resolves relations', async () => {
			const Repo = makeRepo()
			const user = await Repo.insertOne(UserSchema, { email: 'u@test.com', name: 'User' })
			await Repo.insertOne(PostSchema, { title: 'Post', userId: user.id })

			const found = await Repo.findOne(UserSchema, query(eq('id', user.id)), {
				preloads: [UserRelations.definitions.posts],
			})
			expect(found?.posts).toHaveLength(1)
		})
	})
}
