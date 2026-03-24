import type { AnySchema, SchemaOutput } from './schema'

type SchemaKey<S extends AnySchema> = keyof SchemaOutput<S> & string

// ── Relation classes ──────────────────────────────────────────────────────────

export class HasManyRelation<N extends string = string, Src extends AnySchema = AnySchema, Tgt extends AnySchema = AnySchema> {
	constructor(
		readonly name: N,
		readonly source: Src,
		readonly target: Tgt,
		readonly foreignKey: string,
	) {}
}

export class BelongsToRelation<N extends string = string, Src extends AnySchema = AnySchema, Tgt extends AnySchema = AnySchema> {
	constructor(
		readonly name: N,
		readonly source: Src,
		readonly target: Tgt,
		readonly foreignKey: string,
	) {}
}

export class HasOneRelation<N extends string = string, Src extends AnySchema = AnySchema, Tgt extends AnySchema = AnySchema> {
	constructor(
		readonly name: N,
		readonly source: Src,
		readonly target: Tgt,
		readonly foreignKey: string,
	) {}
}

export class ManyToManyRelation<
	N extends string = string,
	Src extends AnySchema = AnySchema,
	Tgt extends AnySchema = AnySchema,
	Join extends AnySchema = AnySchema,
> {
	constructor(
		readonly name: N,
		readonly source: Src,
		readonly target: Tgt,
		readonly joinSchema: Join,
		readonly sourceFk: string,
		readonly targetFk: string,
	) {}
}

export type AnyRelDef =
	| HasManyRelation<string, AnySchema, AnySchema>
	| BelongsToRelation<string, AnySchema, AnySchema>
	| HasOneRelation<string, AnySchema, AnySchema>
	| ManyToManyRelation<string, AnySchema, AnySchema, AnySchema>

export type ResolveRelDef<D extends AnyRelDef> =
	D extends HasManyRelation<any, any, infer T>
		? SchemaOutput<T>[]
		: D extends ManyToManyRelation<any, any, infer T, any>
			? SchemaOutput<T>[]
			: D extends BelongsToRelation<any, any, infer T>
				? SchemaOutput<T> | null
				: D extends HasOneRelation<any, any, infer T>
					? SchemaOutput<T> | null
					: never

export type PreloadedMap<P extends readonly AnyRelDef[]> = {
	[D in P[number] as D['name']]: ResolveRelDef<D>
}

// ── Relations builder class ───────────────────────────────────────────────────

export class Relations<S extends AnySchema, R extends Record<string, AnyRelDef> = Record<never, never>> {
	readonly #source: S
	readonly #defs: R = {} as R

	constructor(source: S) {
		this.#source = source
	}

	hasMany<K extends string, Target extends AnySchema>(
		name: K,
		target: Target,
		foreignKey: SchemaKey<Target>,
	): Relations<S, R & Record<K, HasManyRelation<K, S, Target>>> {
		this.#defs[name] = new HasManyRelation(name, this.#source, target, foreignKey) as any
		return this as unknown as Relations<S, R & Record<K, HasManyRelation<K, S, Target>>>
	}

	belongsTo<K extends string, Target extends AnySchema>(
		name: K,
		target: Target,
		foreignKey: SchemaKey<S>,
	): Relations<S, R & Record<K, BelongsToRelation<K, S, Target>>> {
		this.#defs[name] = new BelongsToRelation(name, this.#source, target, foreignKey) as any
		return this as unknown as Relations<S, R & Record<K, BelongsToRelation<K, S, Target>>>
	}

	hasOne<K extends string, Target extends AnySchema>(
		name: K,
		target: Target,
		foreignKey: SchemaKey<Target>,
	): Relations<S, R & Record<K, HasOneRelation<K, S, Target>>> {
		this.#defs[name] = new HasOneRelation<K, S, Target>(name, this.#source, target, foreignKey) as any
		return this as unknown as Relations<S, R & Record<K, HasOneRelation<K, S, Target>>>
	}

	manyToMany<K extends string, Target extends AnySchema, Join extends AnySchema>(
		name: K,
		target: Target,
		joinSchema: Join,
		sourceFk: SchemaKey<Join>,
		targetFk: SchemaKey<Join>,
	): Relations<S, R & Record<K, ManyToManyRelation<K, S, Target, Join>>> {
		this.#defs[name] = new ManyToManyRelation<K, S, Target, Join>(name, this.#source, target, joinSchema, sourceFk, targetFk) as any
		return this as unknown as Relations<S, R & Record<K, ManyToManyRelation<K, S, Target, Join>>>
	}

	get definitions() {
		return this.#defs
	}

	static of<S extends AnySchema>(source: S) {
		return new Relations(source)
	}
}

if (import.meta.vitest) {
	const { describe, test, expect } = import.meta.vitest
	const { v } = await import('valleyed')
	const { Schema } = await import('./schema')

	describe('relations', () => {
		const UserSchema = Schema.from('users')
			.pk('id', v.string(), () => 'user-id')
			.field('name', v.string())
			.field('orgId', v.string())

		const PostSchema = Schema.from('posts')
			.pk('id', v.string(), () => 'post-id')
			.field('title', v.string())
			.field('userId', v.string())

		const OrgSchema = Schema.from('orgs')
			.pk('id', v.string(), () => 'org-id')
			.field('name', v.string())

		const TagSchema = Schema.from('tags')
			.pk('id', v.string(), () => 'tag-id')
			.field('label', v.string())

		const PostTagSchema = Schema.from('post_tags')
			.pk('id', v.string(), () => 'pt-id')
			.field('postId', v.string())
			.field('tagId', v.string())

		const ProfileSchema = Schema.from('profiles')
			.pk('id', v.string(), () => 'profile-id')
			.field('bio', v.string())
			.field('userId', v.string())

		const UserRelations = Relations.of(UserSchema)
			.hasMany('posts', PostSchema, 'userId')
			.belongsTo('org', OrgSchema, 'orgId')
			.hasOne('profile', ProfileSchema, 'userId')

		const PostRelations = Relations.of(PostSchema)
			.belongsTo('author', UserSchema, 'userId')
			.manyToMany('tags', TagSchema, PostTagSchema, 'postId', 'tagId')

		test('is a Relations instance', () => {
			expect(UserRelations).toBeInstanceOf(Relations)
			expect(UserRelations.definitions.posts).toBeInstanceOf(HasManyRelation)
			expect(UserRelations.definitions.org).toBeInstanceOf(BelongsToRelation)
			expect(UserRelations.definitions.profile).toBeInstanceOf(HasOneRelation)
			expect(PostRelations.definitions.tags).toBeInstanceOf(ManyToManyRelation)
		})

		test('belongsTo stores correct source and target', () => {
			expect(PostRelations.definitions.author.source).toBe(PostSchema)
			expect(PostRelations.definitions.author.target).toBe(UserSchema)
		})

		test('hasMany stores name, foreignKey, source, and target', () => {
			const rel = UserRelations.definitions.posts
			expect(rel.name).toBe('posts')
			expect(rel.foreignKey).toBe('userId')
			expect(rel.source).toBe(UserSchema)
			expect(rel.target).toBe(PostSchema)
		})

		test('hasOne stores name, foreignKey, source, and target', () => {
			const rel = UserRelations.definitions.profile
			expect(rel.name).toBe('profile')
			expect(rel.foreignKey).toBe('userId')
			expect(rel.source).toBe(UserSchema)
			expect(rel.target).toBe(ProfileSchema)
		})

		test('belongsTo stores name and foreignKey', () => {
			const rel = UserRelations.definitions.org
			expect(rel.name).toBe('org')
			expect(rel.foreignKey).toBe('orgId')
		})

		test('manyToMany stores name, joinSchema, sourceFk, targetFk, source, and target', () => {
			const rel = PostRelations.definitions.tags
			expect(rel.name).toBe('tags')
			expect(rel.source).toBe(PostSchema)
			expect(rel.target).toBe(TagSchema)
			expect(rel.joinSchema).toBe(PostTagSchema)
			expect(rel.sourceFk).toBe('postId')
			expect(rel.targetFk).toBe('tagId')
		})
	})
}
