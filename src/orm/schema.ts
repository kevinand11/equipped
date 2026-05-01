import { v, type Pipe, type PipeOutput } from 'valleyed'

import { ComputedField, SchemaField, type AnyComputedField, type AnySchemaField } from './fields'
import type { Prettify } from './utils'

type AnyPrimaryKeyField = SchemaField<string, Pipe<any, any>, true>

export type AnySchema = Schema<string, AnyPrimaryKeyField, Record<string, AnySchemaField>, Record<string, AnyComputedField>>

export type SchemaComputedDefs<S extends AnySchema> = S extends Schema<any, any, any, infer C> ? C : Record<string, AnyComputedField>

export type SchemaPersistedOutput<S extends AnySchema> = Prettify<{
	[K in keyof SchemaFields<S>]: SchemaFields<S>[K] extends SchemaField<any, infer P, any> ? PipeOutput<P> : never
}>

export type SchemaComputedOutput<S extends AnySchema> = Prettify<{
	[K in keyof SchemaComputedDefs<S>]: SchemaComputedDefs<S>[K] extends ComputedField<any, infer P, any> ? PipeOutput<P> : never
}>

export type SchemaOutput<S extends AnySchema> = Prettify<{
	[K in keyof SchemaPersistedOutput<S> | keyof SchemaComputedOutput<S>]: K extends keyof SchemaPersistedOutput<S>
		? SchemaPersistedOutput<S>[K]
		: K extends keyof SchemaComputedOutput<S>
			? SchemaComputedOutput<S>[K]
			: never
}>

export type SchemaFields<S extends AnySchema> =
	S extends Schema<any, infer PKField, infer F, any>
		? PKField extends AnySchemaField
			? Prettify<Record<PKField['name'], PKField> & F>
			: F
		: never

export type SchemaTaggedFields<S extends AnySchema> = {
	[K in keyof SchemaFields<S>]: SchemaFields<S>[K] & { readonly __schema?: S }
}

export class Schema<
	N extends string,
	PKField extends AnyPrimaryKeyField | never = never,
	F extends Record<string, AnySchemaField> = {},
	C extends Record<string, AnyComputedField> = {},
> {
	#name: N
	#pkField: PKField | null = null
	#fieldDefs: F = {} as F
	#computedDefs: C = {} as C

	constructor(name: N) {
		this.#name = name
	}

	pk<K extends string, P extends Pipe<any, any>>(
		name: [PKField] extends [never] ? K : never,
		pipe: P,
		generate: () => PipeOutput<P>,
	): Schema<N, SchemaField<K, P, true>, F> {
		const schema = this as unknown as Schema<N, SchemaField<K, P, true>, F>
		schema.#pkField = new SchemaField(name as string as any, pipe, { onCreate: generate })
		return schema
	}

	field<
		K extends string,
		P extends Pipe<any, any>,
		O extends { onCreate?: () => PipeOutput<P>; onUpdate?: () => PipeOutput<P> } | undefined = undefined,
	>(
		name: K extends keyof F ? never : K,
		pipe: P,
		opts?: O,
	): Schema<
		N,
		PKField,
		{
			[Key in keyof F | K]: Key extends K
				? SchemaField<K, P, [O] extends [{ onCreate: () => any }] ? true : false>
				: Key extends keyof F
					? F[Key]
					: never
		}
	> {
		this.#fieldDefs[name] = new SchemaField(name, pipe, opts) as any
		return this as any
	}

	computed<
		K extends string,
		Deps extends readonly (keyof SchemaPersistedOutput<Schema<N, PKField, F, C>> & string)[],
		P extends Pipe<any, any>,
	>(
		name: K extends keyof SchemaPersistedOutput<Schema<N, PKField, F, C>> | keyof C ? never : K,
		deps: Deps,
		pipe: P,
		compute: (data: Pick<SchemaPersistedOutput<Schema<N, PKField, F, C>>, Deps[number]>) => PipeOutput<P>,
	): Schema<
		N,
		PKField,
		F,
		{
			[Key in keyof C | K]: Key extends K ? ComputedField<K, P, Deps> : Key extends keyof C ? C[Key] : never
		}
	> {
		this.#computedDefs[name as K] = new ComputedField(name as K, pipe, deps, compute as any) as any
		return this as any
	}

	get name() {
		return this.#name
	}

	get pkField() {
		if (!this.#pkField) throw new Error(`Schema "${this.#name}" does not have a primary key defined`)
		return this.#pkField
	}

	get fieldDefs(): F {
		return this.#fieldDefs
	}

	get computedDefs(): C {
		return this.#computedDefs
	}

	get fields() {
		return {
			...(this.#pkField ? { [this.#pkField.name]: this.#pkField } : {}),
			...this.#fieldDefs,
		} as unknown as SchemaTaggedFields<this>
	}
}

export function defineSchema<N extends string, S>(name: N, build: (s: Schema<N>) => S): S {
	return build(new Schema(name))
}

if (import.meta.vitest) {
	const { describe, test, expect, expectTypeOf } = import.meta.vitest

	describe('SchemaBuilder', () => {
		const UserSchema = defineSchema('users', (s) =>
			s
				.pk('id', v.string(), () => 'generated-id')
				.field('email', v.string())
				.field('name', v.string())
				.field('age', v.optional(v.number()))
				.field('createdAt', v.number(), { onCreate: () => 1000 })
				.field('updatedAt', v.number(), { onCreate: () => 1000, onUpdate: () => 2000 }),
		)

		describe('defineSchema()', () => {
			test('returns a Schema instance', () => {
				expect(defineSchema('test', (s) => s)).toBeInstanceOf(Schema)
			})

			test('stores the schema name', () => {
				expect(defineSchema('orders', (s) => s).name).toBe('orders')
			})
		})

		describe('.name', () => {
			test('returns the schema name', () => {
				expect(UserSchema.name).toBe('users')
			})
		})

		describe('.pk()', () => {
			test('pkField returns the pk field', () => {
				expect(UserSchema.pkField.name).toBe('id')
			})

			test('pk entry is a SchemaField instance', () => {
				expect(UserSchema.fields.id).toBeInstanceOf(SchemaField)
			})

			test('pk entry has correct pipe', () => {
				expect(UserSchema.fields.id.pipe).toBeDefined()
			})

			test('pk entry has correct name and path', () => {
				expect(UserSchema.fields.id.name).toBe('id')
				expect(UserSchema.fields.id.path).toEqual(['id'])
			})

			test('pk onCreate generates the value', () => {
				expect(UserSchema.fields.id.onCreate?.()).toBe('generated-id')
			})

			test('pkField throws when no pk defined', () => {
				expect(() => defineSchema('nopk', (s) => s.field('name', v.string())).pkField).toThrow()
			})
		})

		describe('.field()', () => {
			test('all field entries are SchemaField instances', () => {
				for (const entry of Object.values(UserSchema.fieldDefs)) {
					expect(entry).toBeInstanceOf(SchemaField)
				}
			})

			test('field has correct name and path', () => {
				expect(UserSchema.fields.email.name).toBe('email')
				expect(UserSchema.fields.email.path).toEqual(['email'])
			})

			test('field has correct pipe', () => {
				expect(UserSchema.fields.email.pipe).toBeDefined()
				expect(UserSchema.fieldDefs.email.pipe).toBe(UserSchema.fields.email.pipe)
			})

			test('field with onCreate stores the function', () => {
				expect(UserSchema.fields.createdAt.onCreate?.()).toBe(1000)
			})

			test('field with onUpdate stores the function', () => {
				expect(UserSchema.fields.updatedAt.onUpdate?.()).toBe(2000)
			})

			test('field with both hooks stores both', () => {
				expect(UserSchema.fields.updatedAt.onCreate?.()).toBe(1000)
				expect(UserSchema.fields.updatedAt.onUpdate?.()).toBe(2000)
			})

			test('field with no lifecycle has undefined hooks', () => {
				expect(UserSchema.fields.email.onCreate).toBeUndefined()
				expect(UserSchema.fields.email.onUpdate).toBeUndefined()
			})
		})

		describe('.computed()', () => {
			test('registers computed fields and dependencies', () => {
				const WithComputed = defineSchema('users', (s) =>
					s
						.pk('id', v.string(), () => 'u1')
						.field('name', v.string())
						.field('email', v.string())
						.computed('display', ['name', 'email'], v.string(), ({ name, email }) => `${name} <${email}>`),
				)

				expect(Object.keys(WithComputed.computedDefs)).toEqual(['display'])
				expect(WithComputed.computedDefs.display.deps).toEqual(['name', 'email'])
				expect(WithComputed.computedDefs.display.compute({ name: 'Alice', email: 'a@b.com' })).toBe('Alice <a@b.com>')
			})

			test('computed field names are included in schema output type', () => {
				const WithComputed = defineSchema('users', (s) =>
					s
						.pk('id', v.string(), () => 'u1')
						.field('name', v.string())
						.computed('nameUpper', ['name'], v.string(), ({ name }) => name.toUpperCase()),
				)

				type Out = SchemaOutput<typeof WithComputed>
				const value: Out = { id: 'u1', name: 'Alice', nameUpper: 'ALICE' }
				expect(Object.keys(WithComputed.computedDefs)).toEqual(['nameUpper'])
				expect(value.nameUpper).toBe('ALICE')
			})
		})

		describe('.fields', () => {
			test('includes all keys including pk', () => {
				expect(Object.keys(UserSchema.fields)).toEqual(['id', 'email', 'name', 'age', 'createdAt', 'updatedAt'])
			})

			test('pk entry appears first', () => {
				expect(Object.keys(UserSchema.fields)[0]).toBe('id')
			})

			test('schema with no fields has only pk in fields', () => {
				const PkOnly = defineSchema('minimal', (s) => s.pk('id', v.string(), () => 'x'))
				expect(Object.keys(PkOnly.fields)).toEqual(['id'])
			})
		})

		describe('.fieldDefs', () => {
			test('excludes the pk field', () => {
				expect(Object.keys(UserSchema.fieldDefs)).not.toContain('id')
			})

			test('contains all non-pk fields in order', () => {
				expect(Object.keys(UserSchema.fieldDefs)).toEqual(['email', 'name', 'age', 'createdAt', 'updatedAt'])
			})

			test('schema with no fields has empty fieldDefs', () => {
				const PkOnly = defineSchema('minimal', (s) => s.pk('id', v.string(), () => 'x'))
				expect(Object.keys(PkOnly.fieldDefs)).toHaveLength(0)
			})
		})
	})

	describe('type-level: defineSchema uniqueness guard', () => {
		test('duplicate .field() name is a TS error', () => {
			// @ts-expect-error — duplicate field name 'email' should fail
			defineSchema('test', (s) => s.pk('id', v.string(), () => 'x').field('email', v.string()).field('email', v.string()))
		})
	})

	describe('type-level: schema-tagged Fields', () => {
		test('fields accessor returns schema-tagged Field instances', () => {
			const _TestSchema = defineSchema('test', (s) => s.pk('id', v.string(), () => 'x').field('email', v.string()))
			type FieldS = NonNullable<(typeof _TestSchema.fields.id)['__schema']>
			expectTypeOf<FieldS>().toEqualTypeOf<typeof _TestSchema>()

			type FieldS2 = NonNullable<(typeof _TestSchema.fields.email)['__schema']>
			expectTypeOf<FieldS2>().toEqualTypeOf<typeof _TestSchema>()
		})
	})
}
