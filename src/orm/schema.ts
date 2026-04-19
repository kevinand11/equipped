import { v, type Pipe, type PipeOutput } from 'valleyed'

import { SchemaField, type AnySchemaField } from './fields'
import type { Prettify } from './utils'

type AnyPrimaryKeyField = SchemaField<string, Pipe<any, any>, true>

export type AnySchema = Schema<string, AnyPrimaryKeyField, Record<string, AnySchemaField>>

export type SchemaOutput<S extends AnySchema> = Prettify<{
	[K in keyof SchemaFields<S>]: SchemaFields<S>[K] extends SchemaField<any, infer P, any> ? PipeOutput<P> : never
}>

export type SchemaFields<S extends AnySchema> =
	S extends Schema<any, infer PKField, infer F>
		? PKField extends AnySchemaField
			? Prettify<Record<PKField['name'], PKField> & F>
			: F
		: never

export class Schema<N extends string, PKField extends AnyPrimaryKeyField | never = never, F extends Record<string, AnySchemaField> = {}> {
	#name: N
	#pkField: PKField | null = null
	#fieldDefs: F = {} as F

	private constructor(name: N) {
		this.#name = name
	}

	pk<K extends string, P extends Pipe<any, any>>(name: K, pipe: P, generate: () => PipeOutput<P>): Schema<N, SchemaField<K, P, true>, F> {
		const schema = this as unknown as Schema<N, SchemaField<K, P, true>, F>
		schema.#pkField = new SchemaField(name, pipe, { onCreate: generate }) as any
		return schema
	}

	field<
		K extends string,
		P extends Pipe<any, any>,
		O extends { onCreate?: () => PipeOutput<P>; onUpdate?: () => PipeOutput<P> } | undefined = undefined,
	>(
		name: K,
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

	get fields() {
		return {
			...(this.#pkField ? { [this.#pkField.name]: this.#pkField } : {}),
			...this.#fieldDefs,
		} as unknown as SchemaFields<this>
	}

	static from<N extends string>(name: N) {
		return new Schema<N>(name)
	}
}

if (import.meta.vitest) {
	const { describe, test, expect } = import.meta.vitest

	describe('SchemaBuilder', () => {
		const UserSchema = Schema.from('users')
			.pk('id', v.string(), () => 'generated-id')
			.field('email', v.string())
			.field('name', v.string())
			.field('age', v.optional(v.number()))
			.field('createdAt', v.number(), { onCreate: () => 1000 })
			.field('updatedAt', v.number(), { onCreate: () => 1000, onUpdate: () => 2000 })

		describe('Schema.from()', () => {
			test('returns a Schema instance', () => {
				expect(Schema.from('test')).toBeInstanceOf(Schema)
			})

			test('stores the schema name', () => {
				expect(Schema.from('orders').name).toBe('orders')
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
				expect(() => Schema.from('nopk').field('name', v.string()).pkField).toThrow()
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

		describe('.fields', () => {
			test('includes all keys including pk', () => {
				expect(Object.keys(UserSchema.fields)).toEqual(['id', 'email', 'name', 'age', 'createdAt', 'updatedAt'])
			})

			test('pk entry appears first', () => {
				expect(Object.keys(UserSchema.fields)[0]).toBe('id')
			})

			test('schema with no fields has only pk in fields', () => {
				const PkOnly = Schema.from('minimal').pk('id', v.string(), () => 'x')
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
				const PkOnly = Schema.from('minimal').pk('id', v.string(), () => 'x')
				expect(Object.keys(PkOnly.fieldDefs)).toHaveLength(0)
			})
		})
	})
}
