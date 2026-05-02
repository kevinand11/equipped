import { v, type Pipe, type PipeInput, type PipeOutput } from 'valleyed'

import { OrmValidationError, type OrmValidationFailure } from './errors'
import type { AnySchemaField, SchemaField } from './fields'
import { Schema, type AnySchema, type SchemaFields, type SchemaOutput } from './schema'
import { isUpdateOp, type AnyUpdateOp } from './updates'
import type { Prettify } from './utils'

export type SchemaInsertInput<S extends AnySchema> = Prettify<
	{
		[K in keyof SchemaFields<S> as SchemaFields<S>[K] extends SchemaField<any, any, true>
			? never
			: K]: SchemaFields<S>[K] extends AnySchemaField ? PipeInput<SchemaFields<S>[K]['pipe']> : never
	} & {
		[K in keyof SchemaFields<S> as SchemaFields<S>[K] extends SchemaField<any, any, true>
			? K
			: never]?: SchemaFields<S>[K] extends AnySchemaField ? PipeInput<SchemaFields<S>[K]['pipe']> : never
	}
>

export type SchemaUpdateInput<S extends AnySchema> =
	S extends Schema<any, any, infer F>
		? Prettify<{ [K in keyof F]?: F[K] extends AnySchemaField ? PipeInput<F[K]['pipe']> | AnyUpdateOp : never }>
		: Record<string, unknown>

export type SchemaUpdateOutput<S extends AnySchema> =
	S extends Schema<any, any, infer F>
		? Prettify<{ [K in keyof F]?: F[K] extends AnySchemaField ? PipeOutput<F[K]['pipe']> | AnyUpdateOp : never }>
		: Record<string, unknown>

export function tryValidateInsertRow<S extends AnySchema>(
	s: S,
	data: Record<string, unknown>,
): { ok: true; value: SchemaOutput<S> } | { ok: false; failures: OrmValidationFailure[] } {
	const failures: OrmValidationFailure[] = []
	const result: Record<string, unknown> = {}

	for (const [key, entry] of Object.entries(s.fields)) {
		const pipe = entry.onCreate ? v.defaults(entry.pipe, entry.onCreate()) : entry.pipe
		const fieldValue = key in data ? data[key] : undefined
		const validated = v.validate(pipe, fieldValue)
		if (validated.valid) {
			result[key] = validated.value
		} else {
			failures.push({ field: key, cause: validated.error })
		}
	}

	if (failures.length > 0) return { ok: false, failures }
	return { ok: true, value: result as SchemaOutput<S> }
}

export function validateInsert<S extends AnySchema>(s: S, data: Record<string, unknown>): SchemaOutput<S> {
	const result = tryValidateInsertRow(s, data)
	if (!result.ok) {
		throw new OrmValidationError({
			kind: 'validation',
			schema: s.name,
			operation: 'insertOne',
			failures: result.failures,
		})
	}
	return result.value
}

export function validateInsertMany<S extends AnySchema>(s: S, rows: Record<string, unknown>[]): SchemaOutput<S>[] {
	const allFailures: OrmValidationFailure[] = []
	const validated: SchemaOutput<S>[] = []

	for (let i = 0; i < rows.length; i++) {
		const result = tryValidateInsertRow(s, rows[i])
		if (result.ok) {
			validated.push(result.value)
		} else {
			for (const failure of result.failures) {
				allFailures.push({ ...failure, rowIndex: i })
			}
		}
	}

	if (allFailures.length > 0) {
		throw new OrmValidationError({
			kind: 'validation',
			schema: s.name,
			operation: 'insertMany',
			failures: allFailures,
		})
	}

	return validated
}

export function validateUpdate<S extends AnySchema>(s: S, data: Record<string, unknown>): SchemaUpdateOutput<S> {
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
	return { ...validated, ...ops } as SchemaUpdateOutput<S>
}

if (import.meta.vitest) {
	const { describe, test, expect } = import.meta.vitest
	const { inc, IncOp, mul, MulOp, unset, UnsetOp } = await import('./updates')
	const { OrmValidationError } = await import('./errors')

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

		test('throws OrmValidationError on invalid field type', () => {
			try {
				validateInsert(UserSchema, { email: 123, name: 'Alice' })
				expect.unreachable()
			} catch (e) {
				expect(e).toBeInstanceOf(OrmValidationError)
				const err = e as InstanceType<typeof OrmValidationError>
				expect(err.kind).toBe('validation')
				expect(err.schema).toBe('users')
				expect(err.operation).toBe('insertOne')
				expect(err.failures.length).toBeGreaterThan(0)
				expect(err.failures[0].field).toBe('email')
			}
		})

		test('throws OrmValidationError when required field is missing', () => {
			try {
				validateInsert(UserSchema, { email: 'a@b.com' })
				expect.unreachable()
			} catch (e) {
				expect(e).toBeInstanceOf(OrmValidationError)
				const err = e as InstanceType<typeof OrmValidationError>
				expect(err.kind).toBe('validation')
				expect(err.failures.some((f) => f.field === 'name')).toBe(true)
			}
		})

		test('collects all field failures in a single error', () => {
			try {
				validateInsert(UserSchema, { email: 123, name: 456 })
				expect.unreachable()
			} catch (e) {
				expect(e).toBeInstanceOf(OrmValidationError)
				const err = e as InstanceType<typeof OrmValidationError>
				const failedFields = err.failures.map((f) => f.field)
				expect(failedFields).toContain('email')
				expect(failedFields).toContain('name')
			}
		})
	})

	describe('validateInsertMany', () => {
		const ItemSchema = Schema.from('items')
			.pk('id', v.string(), () => 'item-id')
			.field('title', v.string())
			.field('price', v.number())

		test('validates all rows and returns validated documents', () => {
			const results = validateInsertMany(ItemSchema, [
				{ title: 'A', price: 10 },
				{ title: 'B', price: 20 },
			])
			expect(results).toHaveLength(2)
			expect(results[0].title).toBe('A')
			expect(results[1].title).toBe('B')
		})

		test('collects failures across rows with rowIndex populated', () => {
			try {
				validateInsertMany(ItemSchema, [
					{ title: 'Good', price: 10 },
					{ title: 123, price: 20 },
					{ title: 'Also bad', price: 'not-a-number' },
				])
				expect.unreachable()
			} catch (e) {
				expect(e).toBeInstanceOf(OrmValidationError)
				const err = e as InstanceType<typeof OrmValidationError>
				expect(err.kind).toBe('validation')
				expect(err.schema).toBe('items')
				expect(err.operation).toBe('insertMany')
				expect(err.failures.length).toBeGreaterThanOrEqual(2)
				const rowIndices = err.failures.map((f) => f.rowIndex)
				expect(rowIndices).toContain(1)
				expect(rowIndices).toContain(2)
				expect(rowIndices).not.toContain(0)
			}
		})

		test('throws single error even with multiple bad rows', () => {
			try {
				validateInsertMany(ItemSchema, [
					{ title: 1, price: 'bad' },
					{ title: 2, price: 'worse' },
				])
				expect.unreachable()
			} catch (e) {
				expect(e).toBeInstanceOf(OrmValidationError)
				const err = e as InstanceType<typeof OrmValidationError>
				expect(err.failures.filter((f) => f.rowIndex === 0).length).toBeGreaterThan(0)
				expect(err.failures.filter((f) => f.rowIndex === 1).length).toBeGreaterThan(0)
			}
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
