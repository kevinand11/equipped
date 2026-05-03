import type { AnyField, Field } from './fields'
import type { AnySchema, SchemaOutput } from './schema'

type SchemaPkValueType<S extends AnySchema> = NonNullable<S['pkField']['__valueType']>
type FkPkMatch<S extends AnySchema, FK extends AnyField> =
	NonNullable<FK['__valueType']> extends SchemaPkValueType<S> ? FK : never

export class ManyRelation<
	N extends string = string,
	TgtOutput extends Record<string, any> = Record<string, any>,
	FK extends AnyField = AnyField,
> {
	declare readonly _output: TgtOutput
	constructor(
		readonly name: N,
		readonly source: AnySchema,
		readonly target: AnySchema,
		readonly foreignKey: FK,
		readonly references: AnyField,
	) {}
}

export class OneRelation<
	N extends string = string,
	TgtOutput extends Record<string, any> = Record<string, any>,
	FK extends AnyField = AnyField,
> {
	declare readonly _output: TgtOutput
	constructor(
		readonly name: N,
		readonly source: AnySchema,
		readonly target: AnySchema,
		readonly foreignKey: FK,
		readonly fkOwner: 'source' | 'target',
		readonly references: AnyField,
	) {}
}

export type AnyRelDef = ManyRelation<string, Record<string, any>, any> | OneRelation<string, Record<string, any>, any>

export type ResolveRelDef<D extends AnyRelDef> =
	D extends OneRelation<any, infer TOut, any> ? TOut | null : D extends ManyRelation<any, infer TOut, any> ? TOut[] : never

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
	: D extends OneRelation<any, infer TOut, any>
		? (TOut & PreloadedMap<P, Shift<Depth>>) | null
		: D extends ManyRelation<any, infer TOut, any>
			? (TOut & PreloadedMap<P, Shift<Depth>>)[]
			: never

type NodeValue<N extends AnyPreloadDef, Depth extends readonly unknown[]> =
	N extends OneRelation<any, infer TOut, any>
		? TOut | null
		: N extends ManyRelation<any, infer TOut, any>
			? TOut[]
			: N extends { def: infer D extends AnyRelDef; preloads?: infer P extends readonly AnyPreloadDef[] }
				? ResolveRelDefWithNested<D, P, Depth>
				: never

export type PreloadedMap<P extends readonly AnyPreloadDef[], Depth extends readonly unknown[] = [1, 2, 3, 4, 5]> = Depth extends []
	? Record<never, never>
	: {
			[N in P[number] as NodeName<N>]: NodeValue<N, Depth>
		}

// ── Relations builder ────────────────────────────────────────────────────────

class RelationsBuilder<S extends AnySchema, R extends Record<string, AnyRelDef> = Record<never, never>> {
	readonly #source: S
	readonly #defs: Record<string, AnyRelDef> = {}

	constructor(source: S) {
		this.#source = source
	}

	hasMany<K extends string, T extends AnySchema, FK extends Field<any, any, T>>(
		name: K extends keyof R ? never : K,
		fk: FkPkMatch<S, FK>,
	): RelationsBuilder<
		S,
		{
			[Key in keyof R | K]: Key extends K
				? ManyRelation<K, SchemaOutput<T>, FK>
				: Key extends keyof R
					? R[Key]
					: never
		}
	> {
		const target = (fk as any).__schema as AnySchema
		this.#defs[name] = new ManyRelation(name, this.#source, target, fk as any, this.#source.pkField)
		return this as any
	}

	hasOne<K extends string, T extends AnySchema, FK extends Field<any, any, T>>(
		name: K extends keyof R ? never : K,
		fk: FkPkMatch<S, FK>,
	): RelationsBuilder<
		S,
		{
			[Key in keyof R | K]: Key extends K
				? OneRelation<K, SchemaOutput<T>, FK>
				: Key extends keyof R
					? R[Key]
					: never
		}
	> {
		const target = (fk as any).__schema as AnySchema
		this.#defs[name] = new OneRelation(name, this.#source, target, fk as any, 'target', this.#source.pkField)
		return this as any
	}

	belongsTo<K extends string, T extends AnySchema, FK extends Field<any, any, S>>(
		name: K extends keyof R ? never : K,
		fk: FkPkMatch<T, FK>,
		target: T,
		references?: Field<NonNullable<FK['__valueType']>, any, T>,
	): RelationsBuilder<
		S,
		{
			[Key in keyof R | K]: Key extends K
				? OneRelation<K, SchemaOutput<T>, FK>
				: Key extends keyof R
					? R[Key]
					: never
		}
	> {
		const ref = references ?? target.pkField
		this.#defs[name] = new OneRelation(name, this.#source, target, fk as any, 'source', ref as any)
		return this as any
	}

	get definitions(): R {
		return this.#defs as R
	}
}

export function defineRelations<S extends AnySchema, R extends Record<string, AnyRelDef>>(
	source: S,
	build: (rel: RelationsBuilder<S>, src: S) => RelationsBuilder<S, R>,
): R {
	const builder = new RelationsBuilder(source)
	return build(builder, source).definitions
}

if (import.meta.vitest) {
	const { describe, test, expect, expectTypeOf } = import.meta.vitest
	const { v } = await import('valleyed')
	const { defineSchema } = await import('./schema')

	describe('defineRelations', () => {
		const UserSchema = defineSchema('users', (s) =>
			s.pk('id', v.string(), () => 'user-id')
			 .field('name', v.string())
			 .field('orgId', v.string())
			 .field('managerId', v.optional(v.string()), { onCreate: () => undefined }),
		)

		const PostSchema = defineSchema('posts', (s) =>
			s.pk('id', v.string(), () => 'post-id')
			 .field('title', v.string())
			 .field('userId', v.string()),
		)

		const OrgSchema = defineSchema('orgs', (s) =>
			s.pk('id', v.string(), () => 'org-id')
			 .field('name', v.string()),
		)

		const TagSchema = defineSchema('tags', (s) =>
			s.pk('id', v.string(), () => 'tag-id')
			 .field('label', v.string()),
		)

		const PostTagSchema = defineSchema('post_tags', (s) =>
			s.pk('id', v.string(), () => 'pt-id')
			 .field('postId', v.string())
			 .field('tagId', v.string()),
		)

		const ProfileSchema = defineSchema('profiles', (s) =>
			s.pk('id', v.string(), () => 'profile-id')
			 .field('bio', v.string())
			 .field('userId', v.string()),
		)

		const UserRels = defineRelations(UserSchema, (rel, src) => rel
			.hasMany('posts', PostSchema.fields.userId)
			.belongsTo('org', src.fields.orgId, OrgSchema)
			.hasOne('profile', ProfileSchema.fields.userId),
		)

		const PostRels = defineRelations(PostSchema, (rel, src) => rel
			.belongsTo('author', src.fields.userId, UserSchema)
			.hasMany('postTags', PostTagSchema.fields.postId),
		)

		const TagRels = defineRelations(TagSchema, (rel) => rel
			.hasMany('postTags', PostTagSchema.fields.tagId),
		)

		const PostTagRels = defineRelations(PostTagSchema, (rel, src) => rel
			.belongsTo('post', src.fields.postId, PostSchema)
			.belongsTo('tag', src.fields.tagId, TagSchema),
		)

		test('hasMany returns ManyRelation instances', () => {
			expect(UserRels.posts).toBeInstanceOf(ManyRelation)
			expect(PostRels.postTags).toBeInstanceOf(ManyRelation)
			expect(TagRels.postTags).toBeInstanceOf(ManyRelation)
		})

		test('belongsTo returns OneRelation instances', () => {
			expect(UserRels.org).toBeInstanceOf(OneRelation)
			expect(PostRels.author).toBeInstanceOf(OneRelation)
			expect(PostTagRels.post).toBeInstanceOf(OneRelation)
			expect(PostTagRels.tag).toBeInstanceOf(OneRelation)
		})

		test('hasOne returns OneRelation instances', () => {
			expect(UserRels.profile).toBeInstanceOf(OneRelation)
		})

		test('hasMany stores correct source, target, foreignKey, and references', () => {
			const rel = UserRels.posts
			expect(rel.name).toBe('posts')
			expect(rel.source).toBe(UserSchema)
			expect(rel.target).toBe(PostSchema)
			expect(rel.foreignKey).toBe(PostSchema.fields.userId)
			expect(rel.references).toBe(UserSchema.pkField)
		})

		test('hasOne stores correct source, target, foreignKey, and fkOwner', () => {
			const rel = UserRels.profile
			expect(rel.name).toBe('profile')
			expect(rel.source).toBe(UserSchema)
			expect(rel.target).toBe(ProfileSchema)
			expect(rel.foreignKey).toBe(ProfileSchema.fields.userId)
			expect(rel.fkOwner).toBe('target')
			expect(rel.references).toBe(UserSchema.pkField)
		})

		test('belongsTo stores correct source, target, foreignKey, and fkOwner', () => {
			const rel = UserRels.org
			expect(rel.name).toBe('org')
			expect(rel.source).toBe(UserSchema)
			expect(rel.target).toBe(OrgSchema)
			expect(rel.foreignKey).toBe(UserSchema.fields.orgId)
			expect(rel.fkOwner).toBe('source')
			expect(rel.references).toBe(OrgSchema.pkField)
		})

		test('join-table hasMany stores correct metadata', () => {
			const rel = PostRels.postTags
			expect(rel.name).toBe('postTags')
			expect(rel.source).toBe(PostSchema)
			expect(rel.target).toBe(PostTagSchema)
			expect(rel.foreignKey).toBe(PostTagSchema.fields.postId)
		})

		test('join-table belongsTo stores correct metadata', () => {
			const rel = PostTagRels.tag
			expect(rel.name).toBe('tag')
			expect(rel.source).toBe(PostTagSchema)
			expect(rel.target).toBe(TagSchema)
			expect(rel.foreignKey).toBe(PostTagSchema.fields.tagId)
		})

		test('self-referential relation works without special casing', () => {
			const SelfRels = defineRelations(UserSchema, (rel, src) => rel
				.belongsTo('manager', src.fields.managerId!, UserSchema),
			)

			expect(SelfRels.manager).toBeInstanceOf(OneRelation)
			expect(SelfRels.manager.source).toBe(UserSchema)
			expect(SelfRels.manager.target).toBe(UserSchema)
			expect(SelfRels.manager.fkOwner).toBe('source')
		})

		test('many-to-many via explicit join schema', () => {
			expect(PostRels.postTags).toBeInstanceOf(ManyRelation)
			expect(PostTagRels.post).toBeInstanceOf(OneRelation)
			expect(PostTagRels.tag).toBeInstanceOf(OneRelation)
			expect(PostTagRels.post.target).toBe(PostSchema)
			expect(PostTagRels.tag.target).toBe(TagSchema)
		})
	})

	describe('type-level: defineRelations uniqueness guard', () => {
		test('duplicate relation name is a TS error', () => {
			const S = defineSchema('test', (s) => s.pk('id', v.string(), () => 'x'))
			const T = defineSchema('targets', (s) =>
				s.pk('id', v.string(), () => 'x')
				 .field('sId', v.string()),
			)
			// @ts-expect-error — duplicate name 'items' should fail
			defineRelations(S, (rel) => rel.hasMany('items', T.fields.sId).hasMany('items', T.fields.sId))
		})
	})

	describe('type-level: FK-PK type-match guarantee', () => {
		test('string FK pointing at number PK is a TS error', () => {
			const NumPkSchema = defineSchema('nums', (s) =>
				s.pk('id', v.number(), () => 0)
				 .field('name', v.string()),
			)

			const StringFkSchema = defineSchema('strings', (s) =>
				s.pk('id', v.string(), () => 'x')
				 .field('numRef', v.string()),
			)

			// @ts-expect-error — string FK does not match number PK
			defineRelations(NumPkSchema, (rel) => rel.hasMany('items', StringFkSchema.fields.numRef))
		})

		test('matching FK-PK types compile correctly', () => {
			const S = defineSchema('source', (s) => s.pk('id', v.string(), () => 'x'))
			const T = defineSchema('target', (s) =>
				s.pk('id', v.string(), () => 'x')
				 .field('sourceId', v.string()),
			)
			const rels = defineRelations(S, (rel) => rel.hasMany('items', T.fields.sourceId))
			expect(rels.items).toBeInstanceOf(ManyRelation)
		})
	})

	describe('type-level: Field-only-FK rule', () => {
		test('raw string FK is a TS error for hasMany', () => {
			const S = defineSchema('s', (s) => s.pk('id', v.string(), () => 'x'))
			// @ts-expect-error — raw string not allowed, must be a Field instance
			defineRelations(S, (rel) => rel.hasMany('items', 'someKey'))
		})

		test('raw string FK is a TS error for belongsTo', () => {
			const S = defineSchema('s', (s) =>
				s.pk('id', v.string(), () => 'x')
				 .field('ref', v.string()),
			)
			const T = defineSchema('t', (s) => s.pk('id', v.string(), () => 'x'))
			// @ts-expect-error — raw string not allowed, must be a Field instance
			defineRelations(S, (rel) => rel.belongsTo('parent', 'ref', T))
		})
	})

	describe('type-level: schema relations-agnosticism', () => {
		test('schema artifact contains no relational information', () => {
			const _S = defineSchema('users', (s) =>
				s.pk('id', v.string(), () => 'x')
				 .field('name', v.string()),
			)
			type SKeys = keyof typeof _S
			expectTypeOf<'relations' extends SKeys ? true : false>().toEqualTypeOf<false>()
		})
	})
}
