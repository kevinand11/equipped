import type { Pipe, PipeInput, Prettify } from 'valleyed'
import { v } from 'valleyed'
import type { AnySchema, FieldEntry, SchemaFields, SchemaOutput } from './schema'
import { Schema } from './schema'
import { inc, IncOp, isUpdateOp, mul, MulOp, unset, UnsetOp, type AnyUpdateOp } from './updates'

export type SchemaInsertInput<S extends AnySchema> = Prettify<
	{
		[K in keyof SchemaFields<S> as SchemaFields<S>[K] extends { readonly onCreate: () => any }
			? never
			: K]: SchemaFields<S>[K] extends FieldEntry<infer P> ? PipeInput<P> : never
	} & {
		[K in keyof SchemaFields<S> as SchemaFields<S>[K] extends { readonly onCreate: () => any }
			? K
			: never]?: SchemaFields<S>[K] extends FieldEntry<infer P> ? PipeInput<P> : never
	}
>

export type SchemaUpdateInput<S extends AnySchema> =
	S extends Schema<any, any, any, infer F>
		? Prettify<{ [K in keyof F]?: F[K] extends FieldEntry<infer P> ? PipeInput<P> | AnyUpdateOp : never }>
		: Record<string, unknown>

export function validateInsert<S extends AnySchema>(s: S, data: Record<string, unknown>): SchemaOutput<S> {
	return v.assert(
		v.object(
			Object.fromEntries(
				Object.entries(s.fields).map(([key, entry]) => [
					key,
					entry.onCreate ? v.defaults(entry.pipe, entry.onCreate()) : entry.pipe,
				]),
			),
		),
		data,
	) as SchemaOutput<S>
}

export function validateUpdate<S extends AnySchema>(s: S, data: Record<string, unknown>): Partial<SchemaOutput<S>> {
	const pipes: Record<string, Pipe<any, any>> = {}
	const ops: Record<string, unknown> = {}

	for (const [key, value] of Object.entries(data)) {
		if (isUpdateOp(value)) ops[key] = value
		else if (key in s.fieldDefs) pipes[key] = s.fieldDefs[key].pipe
	}

	for (const [key, entry] of Object.entries(s.fieldDefs)) {
		if (!(key in data) && entry.onUpdate) pipes[key] = v.defaults(entry.pipe, entry.onUpdate())
	}

	const validated = v.assert(v.object(pipes), data) as Record<string, unknown>
	return { ...validated, ...ops } as Partial<SchemaOutput<S>>
}

if (import.meta.vitest) {
	const { describe, test, expect } = import.meta.vitest

	describe('validateInsert', () => {
		const UserSchema = Schema.from('users')
			.pk('id', v.string(), () => 'auto-id')
			.field('email', v.string())
			.field('name', v.string())
			.field('age', v.optional(v.number()))
			.field('createdAt', v.number(), { onCreate: () => 1000 })

		test('generates pk when not provided', () => {
			const result = validateInsert(UserSchema, { email: 'a@b.com', name: 'Alice' })
			expect(result.id).toBe('auto-id')
		})

		test('uses provided pk when given', () => {
			const result = validateInsert(UserSchema, { id: 'custom-id', email: 'a@b.com', name: 'Alice' })
			expect(result.id).toBe('custom-id')
		})

		test('applies onCreate generator for generated fields', () => {
			const result = validateInsert(UserSchema, { email: 'a@b.com', name: 'Alice' })
			expect(result.createdAt).toBe(1000)
		})

		test('allows overriding generated field values', () => {
			const result = validateInsert(UserSchema, { email: 'a@b.com', name: 'Alice', createdAt: 9999 })
			expect(result.createdAt).toBe(9999)
		})

		test('optional fields default to undefined when not provided', () => {
			const result = validateInsert(UserSchema, { email: 'a@b.com', name: 'Alice' })
			expect(result.age).toBeUndefined()
		})

		test('strips unknown fields', () => {
			const result = validateInsert(UserSchema, { email: 'a@b.com', name: 'Alice', admin: true })
			expect((result as any).admin).toBeUndefined()
		})

		test('throws on invalid field type', () => {
			expect(() => validateInsert(UserSchema, { email: 123, name: 'Alice' })).toThrow()
		})

		test('throws when required field is missing', () => {
			expect(() => validateInsert(UserSchema, { email: 'a@b.com' })).toThrow()
		})
	})

	describe('validateUpdate', () => {
		const UserSchema = Schema.from('users')
			.pk('id', v.string(), () => 'auto-id')
			.field('email', v.string())
			.field('name', v.string())
			.field('updatedAt', v.number(), { onCreate: () => 1000, onUpdate: () => 2000 })

		test('validates only provided fields', () => {
			const result = validateUpdate(UserSchema, { name: 'Bob' })
			expect(result).toHaveProperty('name', 'Bob')
			expect(result).not.toHaveProperty('email')
		})

		test('applies onUpdate generator for unset generated fields', () => {
			const result = validateUpdate(UserSchema, { name: 'Bob' })
			expect(result).toHaveProperty('updatedAt', 2000)
		})

		test('allows overriding onUpdate field explicitly', () => {
			const result = validateUpdate(UserSchema, { name: 'Bob', updatedAt: 5000 })
			expect(result).toHaveProperty('updatedAt', 5000)
		})

		test('strips unknown fields', () => {
			const result = validateUpdate(UserSchema, { name: 'Bob', admin: true })
			expect((result as any).admin).toBeUndefined()
		})

		test('throws on invalid field type', () => {
			expect(() => validateUpdate(UserSchema, { name: 123 })).toThrow()
		})

		test('passes Op instances through without validation', () => {
			const result = validateUpdate(UserSchema, { name: inc(1) })
			expect(result.name).toBeInstanceOf(IncOp)
		})

		test('Op on a field suppresses onUpdate for that field but not others', () => {
			const result = validateUpdate(UserSchema, { updatedAt: inc(1) })
			expect(result.updatedAt).toBeInstanceOf(IncOp)
		})

		test('plain value and Op can coexist in same update', () => {
			const result = validateUpdate(UserSchema, { name: 'Bob', email: unset() })
			expect(result.name).toBe('Bob')
			expect(result.email).toBeInstanceOf(UnsetOp)
			expect(result.updatedAt).toBe(2000)
		})

		test('Op on onUpdate field suppresses its generator', () => {
			const result = validateUpdate(UserSchema, { updatedAt: mul(2) })
			expect(result.updatedAt).toBeInstanceOf(MulOp)
		})
	})
}
