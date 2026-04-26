import type { AnySchemaField } from './fields'
import type { AnySchema, SchemaFields, SchemaOutput } from './schema'

type SchemaKey<S extends AnySchema> = keyof SchemaFields<S> & string
type SchemaFieldAt<S extends AnySchema, K extends SchemaKey<S> = SchemaKey<S>> = SchemaFields<S>[K]

export class ManyRelation<
	N extends string = string,
	TgtOutput extends Record<string, any> = Record<string, any>,
	FK extends AnySchemaField = AnySchemaField,
> {
	declare readonly _output: TgtOutput
	constructor(
		readonly name: N,
		readonly source: AnySchema,
		readonly target: AnySchema,
		readonly foreignKey: FK,
		readonly references: AnySchemaField,
	) {}
}

export class OneRelation<
	N extends string = string,
	TgtOutput extends Record<string, any> = Record<string, any>,
	FK extends AnySchemaField = AnySchemaField,
> {
	declare readonly _output: TgtOutput
	constructor(
		readonly name: N,
		readonly source: AnySchema,
		readonly target: AnySchema,
		readonly foreignKey: FK,
		readonly fkOwner: 'source' | 'target',
		readonly references: AnySchemaField,
	) {}
}

export type AnyRelDef = ManyRelation<string, Record<string, any>, any> | OneRelation<string, Record<string, any>, any>

export type ResolveRelDef<D extends AnyRelDef> =
	D extends ManyRelation<any, infer TOut, any> ? TOut[] : D extends OneRelation<any, infer TOut, any> ? TOut | null : never

export interface NestedPreloadDef<D extends AnyRelDef = AnyRelDef> {
	def: D
	preloads?: readonly AnyPreloadDef[]
}

export type AnyPreloadDef = AnyRelDef | NestedPreloadDef

type Shift<T extends readonly unknown[]> = T extends readonly [unknown, ...infer R] ? R : []
type NodeName<N extends AnyPreloadDef> = N extends AnyRelDef
	? N['name']
	: N extends NestedPreloadDef<infer D extends AnyRelDef>
		? D['name']
		: never

type ResolveRelDefWithNested<D extends AnyRelDef, P extends readonly AnyPreloadDef[], Depth extends readonly unknown[]> = Depth extends []
	? ResolveRelDef<D>
	: D extends ManyRelation<any, infer TOut, any>
		? (TOut & PreloadedMap<P, Shift<Depth>>)[]
		: D extends OneRelation<any, infer TOut, any>
			? (TOut & PreloadedMap<P, Shift<Depth>>) | null
			: never

type NodeValue<N extends AnyPreloadDef, Depth extends readonly unknown[]> = N extends AnyRelDef
	? ResolveRelDef<N>
	: N extends { def: infer D extends AnyRelDef; preloads?: infer P extends readonly AnyPreloadDef[] }
		? ResolveRelDefWithNested<D, P, Depth>
		: never

export type PreloadedMap<P extends readonly AnyPreloadDef[], Depth extends readonly unknown[] = [1, 2, 3, 4, 5]> = Depth extends []
	? Record<never, never>
	: {
			[N in P[number] as NodeName<N>]: NodeValue<N, Depth>
		}

// ── Relations builder class ───────────────────────────────────────────────────

export class Relations<S extends AnySchema, R extends Record<string, AnyRelDef> = Record<never, never>> {
	readonly #source: S
	readonly #defs: R = {} as R

	private constructor(source: S) {
		this.#source = source
	}

	hasMany<K extends string, Target extends AnySchema, FK extends SchemaKey<Target>, Ref extends SchemaKey<S> = never>(
		name: K,
		target: Target,
		foreignKey: FK,
		references?: Ref,
	): Relations<
		S,
		{
			[Key in keyof R | K]: Key extends K
				? ManyRelation<K, SchemaOutput<Target>, SchemaFieldAt<Target, FK>>
				: Key extends keyof R
					? R[Key]
					: never
		}
	> {
		const ref = references != null ? this.#source.fields[references] : this.#source.pkField
		this.#defs[name] = new ManyRelation(name, this.#source, target, target.fields[foreignKey], ref) as any
		return this as any
	}

	belongsTo<K extends string, Target extends AnySchema, FK extends SchemaKey<S>, Ref extends SchemaKey<Target> = never>(
		name: K,
		target: Target,
		foreignKey: FK,
		references?: Ref,
	): Relations<
		S,
		{
			[Key in keyof R | K]: Key extends K
				? OneRelation<K, SchemaOutput<Target>, SchemaFieldAt<S, FK>>
				: Key extends keyof R
					? R[Key]
					: never
		}
	> {
		const ref = references ? target.fields[references] : target.pkField
		this.#defs[name] = new OneRelation(name, this.#source, target, this.#source.fields[foreignKey], 'source', ref) as any
		return this as any
	}

	hasOne<K extends string, Target extends AnySchema, FK extends SchemaKey<Target>, Ref extends SchemaKey<S> = never>(
		name: K,
		target: Target,
		foreignKey: FK,
		references?: Ref,
	): Relations<
		S,
		{
			[Key in keyof R | K]: Key extends K
				? OneRelation<K, SchemaOutput<Target>, SchemaFieldAt<Target, FK>>
				: Key extends keyof R
					? R[Key]
					: never
		}
	> {
		const ref = references ? this.#source.fields[references] : this.#source.pkField
		this.#defs[name] = new OneRelation(name, this.#source, target, target.fields[foreignKey], 'target', ref) as any
		return this as any
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
			.hasMany('postTags', PostTagSchema, 'postId')

		const TagRelations = Relations.of(TagSchema).hasMany('postTags', PostTagSchema, 'tagId')

		const PostTagRelations = Relations.of(PostTagSchema).belongsTo('post', PostSchema, 'postId').belongsTo('tag', TagSchema, 'tagId')

		test('is a Relations instance', () => {
			expect(UserRelations).toBeInstanceOf(Relations)
			expect(UserRelations.definitions.posts).toBeInstanceOf(ManyRelation)
			expect(UserRelations.definitions.org).toBeInstanceOf(OneRelation)
			expect(UserRelations.definitions.profile).toBeInstanceOf(OneRelation)
			expect(PostRelations.definitions.postTags).toBeInstanceOf(ManyRelation)
			expect(TagRelations.definitions.postTags).toBeInstanceOf(ManyRelation)
			expect(PostTagRelations.definitions.post).toBeInstanceOf(OneRelation)
			expect(PostTagRelations.definitions.tag).toBeInstanceOf(OneRelation)
		})

		test('belongsTo stores correct source and target', () => {
			expect(PostRelations.definitions.author.source).toBe(PostSchema)
			expect(PostRelations.definitions.author.target).toBe(UserSchema)
		})

		test('hasMany stores name, foreignKey, source, and target', () => {
			const rel = UserRelations.definitions.posts
			expect(rel.name).toBe('posts')
			expect(rel.foreignKey).toBe(PostSchema.fields.userId)
			expect(rel.source).toBe(UserSchema)
			expect(rel.target).toBe(PostSchema)
		})

		test('hasOne stores name, foreignKey, source, and target', () => {
			const rel = UserRelations.definitions.profile
			expect(rel.name).toBe('profile')
			expect(rel.foreignKey).toBe(ProfileSchema.fields.userId)
			expect(rel.source).toBe(UserSchema)
			expect(rel.target).toBe(ProfileSchema)
		})

		test('belongsTo stores name and foreignKey', () => {
			const rel = UserRelations.definitions.org
			expect(rel.name).toBe('org')
			expect(rel.foreignKey).toBe(UserSchema.fields.orgId)
		})

		test('join-table hasMany stores name, foreignKey, source, and target', () => {
			const rel = PostRelations.definitions.postTags
			expect(rel.name).toBe('postTags')
			expect(rel.source).toBe(PostSchema)
			expect(rel.target).toBe(PostTagSchema)
			expect(rel.foreignKey).toBe(PostTagSchema.fields.postId)
		})

		test('join-table belongsTo stores name, foreignKey, source, and target', () => {
			const rel = PostTagRelations.definitions.tag
			expect(rel.name).toBe('tag')
			expect(rel.source).toBe(PostTagSchema)
			expect(rel.target).toBe(TagSchema)
			expect(rel.foreignKey).toBe(PostTagSchema.fields.tagId)
		})
	})
}
