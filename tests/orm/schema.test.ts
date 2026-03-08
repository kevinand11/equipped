import { v } from 'valleyed'
import { describe, expect, it } from 'vitest'
import { computeSchema, schema, validatePartialSchema, validateSchema } from '../../src/orm/schema'

describe('orm/schema', () => {
	describe('schema()', () => {
		it('creates a schema with field definitions and primaryKey', () => {
			const UserSchema = schema({
				id: v.string(),
				name: v.string(),
				age: v.number(),
			}).pk('id', () => 'test-id')

			expect(UserSchema.fields).toBeDefined()
			expect(UserSchema.associations).toEqual({})
			expect(UserSchema.computeds).toEqual({})
			expect(UserSchema.primaryKey).toBe('id')
			expect(Object.keys(UserSchema.fields)).toEqual(['id', 'name', 'age'])
		})

		it('stores fields and associations separately', () => {
			const ParentSchema = schema({ id: v.string(), name: v.string() }).pk('id', () => 'test-id')
			const ChildSchema = schema({
				id: v.string(),
				title: v.string(),
				parentId: v.string(),
			})
				.pk('id', () => 'test-id')
				.belongsTo('parent', () => ParentSchema, 'parentId')

			expect(Object.keys(ChildSchema.fields)).toEqual(['id', 'title', 'parentId'])
			expect(Object.keys(ChildSchema.associations)).toEqual(['parent'])
			expect(ChildSchema.associations.parent.type).toBe('belongsTo')
		})

		it('supports computed fields via computed()', () => {
			const S = schema({
				id: v.string(),
				firstName: v.string(),
				lastName: v.string(),
			})
				.pk('id', () => 'test-id')
				.computed('fullName', v.string(), (data) => `${data.firstName} ${data.lastName}`)

			expect(Object.keys(S.fields)).toEqual(['id', 'firstName', 'lastName'])
			expect(Object.keys(S.computeds)).toEqual(['fullName'])
			expect(S.computeds.fullName.__kind).toBe('computed')
		})

		it('handles schema with no associations', () => {
			const S = schema({ id: v.number(), x: v.number() }).pk('id', () => 0)
			expect(S.fields).toBeDefined()
			expect(S.associations).toEqual({})
		})

		it('handles schema with multiple associations', () => {
			const A = schema({ id: v.string() }).pk('id', () => 'test-id')
			const B = schema({ id: v.string() }).pk('id', () => 'test-id')

			const C = schema({
				id: v.string(),
				name: v.string(),
				aId: v.string(),
			})
				.pk('id', () => 'test-id')
				.belongsTo('assocA', () => A, 'aId')
				.hasMany('assocBs', () => B, 'cId')

			expect(Object.keys(C.fields)).toEqual(['id', 'name', 'aId'])
			expect(Object.keys(C.associations)).toEqual(['assocA', 'assocBs'])
		})

		it('supports non-string primary key types', () => {
			const S = schema({ id: v.number(), name: v.string() }).pk('id', () => 0)
			expect(S.primaryKey).toBe('id')
		})
	})

	describe('computed()', () => {
		it('creates a computed field definition', () => {
			const s = schema({ a: v.string(), b: v.string() })
				.pk('a', () => 'test-a')
				.computed('result', v.string(), (data) => `${data.a}-${data.b}`)
			expect(s.computeds.result.__kind).toBe('computed')
			expect(s.computeds.result.pipe).toBeDefined()
			expect(s.computeds.result.compute).toBeInstanceOf(Function)
		})

		it('compute function receives data and returns value', () => {
			const s = schema({ a: v.number(), b: v.number() })
				.pk('a', () => 0)
				.computed('sum', v.number(), (data) => data.a + data.b)
			expect(s.computeds.sum.compute({ a: 1, b: 2 })).toBe(3)
		})
	})

	describe('association constructors', () => {
		const TargetSchema = schema({ id: v.string(), name: v.string() }).pk('id', () => 'test-id')

		it('creates belongsTo association', () => {
			const s = schema({ id: v.string(), targetId: v.string() })
				.pk('id', () => 'test-id')
				.belongsTo('target', () => TargetSchema, 'targetId')
			expect(s.associations.target.type).toBe('belongsTo')
			expect(s.associations.target.foreignKey).toBe('targetId')
			expect(s.associations.target.schema()).toBe(TargetSchema)
		})

		it('creates hasOne association', () => {
			const s = schema({ id: v.string() })
				.pk('id', () => 'test-id')
				.hasOne('target', () => TargetSchema, 'ownerId')
			expect(s.associations.target.type).toBe('hasOne')
			expect(s.associations.target.foreignKey).toBe('ownerId')
			expect(s.associations.target.schema()).toBe(TargetSchema)
		})

		it('creates hasMany association', () => {
			const s = schema({ id: v.string() })
				.pk('id', () => 'test-id')
				.hasMany('targets', () => TargetSchema, 'ownerId')
			expect(s.associations.targets.type).toBe('hasMany')
			expect(s.associations.targets.foreignKey).toBe('ownerId')
			expect(s.associations.targets.schema()).toBe(TargetSchema)
		})

		it('creates manyToMany association', () => {
			const JoinSchema = schema({ id: v.string(), aId: v.string(), bId: v.string() }).pk('id', () => 'test-id')
			const s = schema({ id: v.string() })
				.pk('id', () => 'test-id')
				.manyToMany(
					'targets',
					() => TargetSchema,
					() => JoinSchema,
					'aId',
					'bId',
				)
			expect(s.associations.targets.type).toBe('manyToMany')
			expect(s.associations.targets.thisForeignKey).toBe('aId')
			expect(s.associations.targets.thatForeignKey).toBe('bId')
			expect(s.associations.targets.schema()).toBe(TargetSchema)
			expect(s.associations.targets.joinSchema()).toBe(JoinSchema)
		})
	})

	describe('index()', () => {
		it('creates a schema with no indexes by default', () => {
			const S = schema({ id: v.string(), name: v.string() }).pk('id', () => 'test-id')
			expect(S.indexes).toEqual([])
		})

		it('adds a single-field index', () => {
			const S = schema({ id: v.string(), email: v.string() })
				.pk('id', () => 'test-id')
				.index('idx_email', ['email'])
			expect(S.indexes).toEqual([{ name: 'idx_email', fields: ['email'] }])
		})

		it('adds a unique index', () => {
			const S = schema({ id: v.string(), email: v.string() })
				.pk('id', () => 'test-id')
				.index('idx_email_unique', ['email'], { unique: true })
			expect(S.indexes).toEqual([{ name: 'idx_email_unique', fields: ['email'], unique: true }])
		})

		it('adds a compound index', () => {
			const S = schema({ id: v.string(), name: v.string(), age: v.number() })
				.pk('id', () => 'test-id')
				.index('idx_name_age', ['name', 'age'])
			expect(S.indexes).toEqual([{ name: 'idx_name_age', fields: ['name', 'age'] }])
		})

		it('accumulates multiple indexes', () => {
			const S = schema({ id: v.string(), name: v.string(), email: v.string() })
				.pk('id', () => 'test-id')
				.index('idx_name', ['name'])
				.index('idx_email', ['email'], { unique: true })
			expect(S.indexes).toHaveLength(2)
			expect(S.indexes[0]).toEqual({ name: 'idx_name', fields: ['name'] })
			expect(S.indexes[1]).toEqual({ name: 'idx_email', fields: ['email'], unique: true })
		})

		it('preserves indexes through other builder methods', () => {
			const Other = schema({ id: v.string() }).pk('id', () => 'test-id')
			const S = schema({ id: v.string(), name: v.string(), otherId: v.string() })
				.pk('id', () => 'test-id')
				.index('idx_name', ['name'])
				.computed('upper', v.string(), (d) => d.name.toUpperCase())
				.belongsTo('other', () => Other, 'otherId')
			expect(S.indexes).toEqual([{ name: 'idx_name', fields: ['name'] }])
		})
	})

	describe('validateSchema()', () => {
		const UserSchema = schema({ id: v.string(), name: v.string(), age: v.number() }).pk('id', () => 'test-id')

		it('validates and returns correct data (excluding PK)', () => {
			const result = validateSchema(UserSchema, { name: 'John', age: 30 })
			expect(result).toEqual({ name: 'John', age: 30 })
		})

		it('throws on invalid data', () => {
			expect(() => validateSchema(UserSchema, { name: 123, age: 'abc' })).toThrow()
		})

		it('throws on missing required fields', () => {
			expect(() => validateSchema(UserSchema, { name: 'John' })).toThrow()
		})

		it('does not compute computed fields on write', () => {
			const S = schema({
				id: v.string(),
				a: v.number(),
				b: v.number(),
			})
				.pk('id', () => 'test-id')
				.computed('sum', v.number(), (data) => data.a + data.b)

			const result = validateSchema(S, { a: 3, b: 7 })
			expect(result).toEqual({ a: 3, b: 7 })
			expect(result).not.toHaveProperty('sum')
		})
	})

	describe('computeSchema()', () => {
		it('computes and validates computed fields on read', () => {
			const S = schema({
				id: v.string(),
				a: v.number(),
				b: v.number(),
			})
				.pk('id', () => 'test-id')
				.computed('sum', v.number(), (data) => data.a + data.b)

			const result = computeSchema(S, { id: 'x', a: 3, b: 7 })
			expect(result).toEqual({ id: 'x', a: 3, b: 7, sum: 10 })
		})

		it('throws when computed value fails validation', () => {
			const S = schema({
				id: v.string(),
				x: v.string(),
			})
				.pk('id', () => 'test-id')
				.computed('num', v.number(), () => 'not-a-number' as any)

			expect(() => computeSchema(S, { id: 'x', x: 'hello' })).toThrow()
		})

		it('returns data unchanged when no computeds', () => {
			const S = schema({ id: v.string(), name: v.string() }).pk('id', () => 'test-id')
			const data = { id: '1', name: 'John' }
			const result = computeSchema(S, data)
			expect(result).toEqual({ id: '1', name: 'John' })
		})
	})

	describe('validatePartialSchema()', () => {
		const UserSchema = schema({ id: v.string(), name: v.string(), age: v.number() }).pk('id', () => 'test-id')

		it('validates a subset of fields', () => {
			const result = validatePartialSchema(UserSchema, { name: 'Jane' })
			expect(result).toEqual({ name: 'Jane' })
		})

		it('ignores unknown fields', () => {
			const result = validatePartialSchema(UserSchema, { name: 'Jane', unknown: true })
			expect(result).toEqual({ name: 'Jane' })
		})

		it('throws on invalid field values', () => {
			expect(() => validatePartialSchema(UserSchema, { age: 'not-a-number' })).toThrow()
		})

		it('returns empty object for empty input', () => {
			const result = validatePartialSchema(UserSchema, {})
			expect(result).toEqual({})
		})

		it('validates primaryKey if present in data', () => {
			const result = validatePartialSchema(UserSchema, { id: 'some-id', name: 'Jane' })
			expect(result).toEqual({ id: 'some-id', name: 'Jane' })
		})

		it('ignores computed fields in partial update', () => {
			const S = schema({
				id: v.string(),
				x: v.string(),
			})
				.pk('id', () => 'test-id')
				.computed('comp', v.number(), (data) => data.x.length)

			const result = validatePartialSchema(S, { comp: 42 })
			expect(result).toEqual({})
		})
	})
})
