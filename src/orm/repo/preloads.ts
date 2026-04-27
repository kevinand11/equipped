import { EquippedError } from '../../errors'
import type { OrmUse } from '../adapters/base'
import { Query } from '../query'
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
			const fkValues = uniqueDefinedValues(entities, def.foreignKey.name)
			if (fkValues.length === 0) return entities.map((e) => ({ ...e, [name]: null }))

			let related = await getUse(target).findMany(Query.from().isIn(refCol, fkValues).toQuerySpec())
			if (node.preloads.length > 0 && related.length > 0) {
				related = await resolvePreloadNodes(related, node.preloads, getUse, depth + 1, nextPath)
			}
			const lookup = new Map(related.map((r) => [r[refCol], r]))
			return attachOneRelation(entities, name, def.foreignKey.name, lookup)
		}

		const refCol = def.references.name
		const refValues = uniqueDefinedValues(entities, refCol)
		if (refValues.length === 0) return entities.map((e) => ({ ...e, [name]: null }))

		let related = await getUse(target).findMany(Query.from().isIn(def.foreignKey, refValues).toQuerySpec())
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

		let related = await getUse(target).findMany(Query.from().isIn(def.foreignKey, refValues).toQuerySpec())
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
	const { InMemoryOrm } = await import('../adapters/in-memory')
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
			return Repo.from({ adapter, resolve: (s) => ({ prefix: s.name }) })
		}

		test('hasMany preload resolves related entities', async () => {
			const Repo = makeRepo()
			const user = await Repo.from(UserSchema).one().insert({ email: 'u@test.com', name: 'User' }).run()
			await Repo.from(PostSchema).one().insert({ title: 'Post 1', userId: user.id }).run()
			await Repo.from(PostSchema).one().insert({ title: 'Post 2', userId: user.id }).run()

			const users = await Repo.from(UserSchema).all().preload([UserRelations.definitions.posts]).run()
			expect(users[0].posts).toHaveLength(2)
		})

		test('hasOne and belongsTo preloads resolve null and non-null branches', async () => {
			const Repo = makeRepo()
			const user = await Repo.from(UserSchema).one().insert({ email: 'x@test.com', name: 'X' }).run()
			await Repo.from(ProfileSchema).one().insert({ bio: 'Hello', userId: user.id }).run()

			const users = await Repo.from(UserSchema).all().preload([UserRelations.definitions.profile]).run()
			expect(users[0].profile?.bio).toBe('Hello')

			const usersWithoutOrg = await Repo.from(UserSchema).all().preload([UserRelations.definitions.org]).run()
			expect(usersWithoutOrg[0].org).toBeNull()
		})

		test('nested preload resolves recursively', async () => {
			const Repo = makeRepo()
			const user = await Repo.from(UserSchema).one().insert({ email: 'nested@test.com', name: 'Nested User' }).run()
			await Repo.from(ProfileSchema).one().insert({ bio: 'Hello nested', userId: user.id }).run()
			await Repo.from(PostSchema).one().insert({ title: 'Nested Post', userId: user.id }).run()

			const users = await Repo.from(UserSchema)
				.all()
				.preload([
					{
						def: UserRelations.definitions.posts,
						preloads: [{ def: PostRelations.definitions.author, preloads: [UserRelations.definitions.profile] }],
					},
				])
				.run()

			const author = users[0].posts[0].author
			const profile = author?.profile
			expect(author?.id).toBe(user.id)
			expect(profile?.bio).toBe('Hello nested')
		})

		test('cycle detection throws descriptive error', async () => {
			const Repo = makeRepo()
			const user = await Repo.from(UserSchema).one().insert({ email: 'cycle@test.com', name: 'Cycle User' }).run()
			await Repo.from(PostSchema).one().insert({ title: 'Cycle Post', userId: user.id }).run()

			await expect(
				Repo.from(UserSchema)
					.all()
					.preload([
						{
							def: UserRelations.definitions.posts,
							preloads: [{ def: PostRelations.definitions.author, preloads: [UserRelations.definitions.posts] }],
						},
					])
					.run(),
			).rejects.toThrow(/Preload cycle detected/)
		})

		test('depth limit throws when chain exceeds max depth', async () => {
			const Repo = makeRepo()
			const a = await Repo.from(ASchema).one().insert({}).run()
			const b = await Repo.from(BSchema).one().insert({ aId: a.id }).run()
			const c = await Repo.from(CSchema).one().insert({ bId: b.id }).run()
			const d = await Repo.from(DSchema).one().insert({ cId: c.id }).run()
			const e = await Repo.from(ESchema).one().insert({ dId: d.id }).run()
			const f = await Repo.from(FSchema).one().insert({ eId: e.id }).run()
			await Repo.from(GSchema).one().insert({ fId: f.id }).run()

			await expect(
				Repo.from(ASchema)
					.all()
					.preload([
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
					])
					.run(),
			).rejects.toThrow(/Preload depth exceeded/)
		})

		test('invalid nested preload definition throws a validation error', async () => {
			const Repo = makeRepo()
			await Repo.from(UserSchema).one().insert({ email: 'u@test.com', name: 'User' }).run()

			await expect(
				Repo.from(UserSchema)
					.all()
					.preload([{ def: {} as any }])
					.run(),
			).rejects.toThrow(/Invalid preload definition/)
		})

		test('findOne with preloads resolves relations', async () => {
			const Repo = makeRepo()
			const user = await Repo.from(UserSchema).one().insert({ email: 'u@test.com', name: 'User' }).run()
			await Repo.from(PostSchema).one().insert({ title: 'Post', userId: user.id }).run()

			const found = await Repo.from(UserSchema).one().id(user.id).preload([UserRelations.definitions.posts]).run()
			expect(found?.posts).toHaveLength(1)
		})
	})
}
