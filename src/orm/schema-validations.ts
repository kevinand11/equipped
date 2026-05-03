import { v, type Pipe, type PipeInput, type PipeOutput } from 'valleyed'

import { EquippedError } from '../errors'
import type { AnySchemaField, SchemaField } from './fields'
import { Schema, defineSchema, type AnySchema, type SchemaFields, type SchemaOutput } from './schema'
import { SetOp, isUpdateOp, opTouchedFields, type AnyUpdateOp } from './updates'
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
		? { [K in keyof F]?: F[K] extends AnySchemaField ? PipeInput<F[K]['pipe']> | AnyUpdateOp : never }
		: Record<string, unknown>

export type SchemaUpdateOutput<S extends AnySchema> =
	S extends Schema<any, any, infer F>
		? { [K in keyof F]?: F[K] extends AnySchemaField ? PipeOutput<F[K]['pipe']> | AnyUpdateOp : never }
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

// ---------------------------------------------------------------------------
// OrmValidationError
// ---------------------------------------------------------------------------

export type OrmValidationErrorKind = 'validation' | 'conflicting-ops' | 'empty-group' | 'undeclared-op' | 'upsert-filter-incompatible'

export type OrmValidationFailure = {
	opIndex?: number
	rowIndex?: number
	field?: string
	cause: unknown
}

export class OrmValidationError extends EquippedError {
	constructor(
		readonly kind: OrmValidationErrorKind,
		readonly schema: string,
		readonly operation: string,
		readonly failures: OrmValidationFailure[],
	) {
		super(`ORM validation error (${kind}) on ${schema}.${operation}`, {
			kind,
			schema,
			operation,
			failures,
		})
	}
}

// ---------------------------------------------------------------------------
// Update-validation pipeline for the new op-list path (repo.updateByPk)
// ---------------------------------------------------------------------------

export function validateUpdateOps(schema: AnySchema, ops: AnyUpdateOp[]): AnyUpdateOp[] {
	const touched = new Map<string, number[]>()

	for (let i = 0; i < ops.length; i++) {
		for (const field of opTouchedFields(ops[i])) {
			if (!touched.has(field)) touched.set(field, [])
			touched.get(field)!.push(i)
		}
	}

	const autoBumped: AnyUpdateOp[] = []
	for (const [key, entry] of Object.entries(schema.fieldDefs)) {
		if (entry.onUpdate && !touched.has(key)) {
			const bumpOp = new SetOp({ [key]: entry.onUpdate() })
			autoBumped.push(bumpOp)
			touched.set(key, [ops.length + autoBumped.length - 1])
		}
	}

	const allOps = [...ops, ...autoBumped]

	const conflicts: OrmValidationFailure[] = []
	for (const [field, indices] of touched) {
		if (indices.length > 1) {
			conflicts.push({ field, cause: `field "${field}" touched by multiple ops at indices [${indices.join(', ')}]` })
		}
	}
	if (conflicts.length > 0) {
		throw new OrmValidationError('conflicting-ops', schema.name, 'updateByPk', conflicts)
	}

	const failures: OrmValidationFailure[] = []
	for (let i = 0; i < allOps.length; i++) {
		const op = allOps[i]
		if (op instanceof SetOp) {
			for (const [key, value] of Object.entries(op.values)) {
				const fieldDef = schema.fields[key] as AnySchemaField | undefined
				if (!fieldDef) continue
				try {
					v.assert(fieldDef.pipe, value)
				} catch (cause) {
					failures.push({ opIndex: i, field: key, cause })
				}
			}
		}
	}
	if (failures.length > 0) {
		throw new OrmValidationError('validation', schema.name, 'updateByPk', failures)
	}

	return allOps
}

if (import.meta.vitest) {
	const { describe, test, expect } = import.meta.vitest
	const { IncOp, MulOp, SetOp, UnsetOp } = await import('./updates')

	describe('validateInsert', () => {
		const UserSchema = defineSchema('users', (s) =>
			s.pk('id', v.string(), () => 'auto-id')
			 .field('email', v.string())
			 .field('name', v.string())
			 .field('age', v.optional(v.number()))
			 .field('createdAt', v.number(), { onCreate: () => 1000 }),
		)

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
		const UserSchema = defineSchema('users', (s) =>
			s.pk('id', v.string(), () => 'auto-id')
			 .field('email', v.string())
			 .field('name', v.string())
			 .field('updatedAt', v.number(), { onCreate: () => 1000, onUpdate: () => 2000 }),
		)

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
			const result = validateUpdate(UserSchema, { name: new IncOp('name', 1) })
			expect(result.name).toBeInstanceOf(IncOp)
		})

		test('Op on a field suppresses onUpdate for that field but not others', () => {
			const result = validateUpdate(UserSchema, { updatedAt: new IncOp('updatedAt', 1) })
			expect(result.updatedAt).toBeInstanceOf(IncOp)
		})

		test('plain value and Op can coexist in same update', () => {
			const result = validateUpdate(UserSchema, { name: 'Bob', email: new UnsetOp('email') })
			expect(result.name).toBe('Bob')
			expect(result.email).toBeInstanceOf(UnsetOp)
			expect(result.updatedAt).toBe(2000)
		})

		test('Op on onUpdate field suppresses its generator', () => {
			const result = validateUpdate(UserSchema, { updatedAt: new MulOp('updatedAt', 2) })
			expect(result.updatedAt).toBeInstanceOf(MulOp)
		})
	})

	describe('OrmValidationError', () => {
		test('has correct kind, schema, operation, and failures', () => {
			const err = new OrmValidationError('conflicting-ops', 'users', 'updateByPk', [
				{ field: 'views', cause: 'conflict' },
			])
			expect(err).toBeInstanceOf(EquippedError)
			expect(err.kind).toBe('conflicting-ops')
			expect(err.schema).toBe('users')
			expect(err.operation).toBe('updateByPk')
			expect(err.failures).toHaveLength(1)
		})
	})

	describe('validateUpdateOps', () => {
		const UpdateSchema = defineSchema('items', (s) =>
			s
				.pk('id', v.string(), () => 'auto')
				.field('name', v.string())
				.field('views', v.number())
				.field('updatedAt', v.number(), { onCreate: () => 1000, onUpdate: () => 2000 }),
		)

		test('passes through valid ops', () => {
			const ops = validateUpdateOps(UpdateSchema, [new SetOp({ name: 'New Name' })])
			expect(ops.length).toBeGreaterThanOrEqual(1)
			expect(ops[0]).toBeInstanceOf(SetOp)
		})

		test('auto-bumps onUpdate fields not touched by user ops', () => {
			const ops = validateUpdateOps(UpdateSchema, [new SetOp({ name: 'New Name' })])
			const bumped = ops.find((op) => op instanceof SetOp && 'updatedAt' in op.values && op !== ops[0])
			expect(bumped).toBeDefined()
			expect((bumped as SetOp).values.updatedAt).toBe(2000)
		})

		test('user set({updatedAt:X}) suppresses auto-bump for that field', () => {
			const ops = validateUpdateOps(UpdateSchema, [new SetOp({ updatedAt: 9999 })])
			const setOps = ops.filter((op) => op instanceof SetOp) as SetOp[]
			const allUpdatedAtValues = setOps.flatMap((op) =>
				'updatedAt' in op.values ? [op.values.updatedAt] : [],
			)
			expect(allUpdatedAtValues).toEqual([9999])
		})

		test('atomic op on onUpdate field suppresses auto-bump', () => {
			const ops = validateUpdateOps(UpdateSchema, [new IncOp('updatedAt', 1)])
			const setOps = ops.filter((op) => op instanceof SetOp) as SetOp[]
			const hasAutoBumpedUpdatedAt = setOps.some((op) => 'updatedAt' in op.values)
			expect(hasAutoBumpedUpdatedAt).toBe(false)
		})

		test('set({views:0}) + inc(views, 1) throws conflicting-ops', () => {
			expect(() =>
				validateUpdateOps(UpdateSchema, [new SetOp({ views: 0 }), new IncOp('views', 1)]),
			).toThrow(OrmValidationError)

			try {
				validateUpdateOps(UpdateSchema, [new SetOp({ views: 0 }), new IncOp('views', 1)])
			} catch (e) {
				const err = e as OrmValidationError
				expect(err.kind).toBe('conflicting-ops')
				expect(err.failures[0].field).toBe('views')
			}
		})

		test('cross-kind conflict (unset + inc on same field) throws', () => {
			const UpdateSchema2 = defineSchema('items2', (s) =>
				s
					.pk('id', v.string(), () => 'auto')
					.field('score', v.optional(v.number())),
			)
			expect(() =>
				validateUpdateOps(UpdateSchema2, [new UnsetOp('score'), new IncOp('score', 5)]),
			).toThrow(OrmValidationError)
		})

		test('SetOp values are pipe-validated', () => {
			expect(() =>
				validateUpdateOps(UpdateSchema, [new SetOp({ name: 123 as any })]),
			).toThrow(OrmValidationError)

			try {
				validateUpdateOps(UpdateSchema, [new SetOp({ name: 123 as any })])
			} catch (e) {
				const err = e as OrmValidationError
				expect(err.kind).toBe('validation')
				expect(err.failures[0].field).toBe('name')
			}
		})

		test('atomic op operands are NOT pipe-validated', () => {
			const ops = validateUpdateOps(UpdateSchema, [new IncOp('views', -999)])
			expect(ops).toHaveLength(2)
		})

		test('auto-bumped SetOp values are pipe-validated', () => {
			const BadSchema = defineSchema('bad', (s) =>
				s
					.pk('id', v.string(), () => 'auto')
					.field('name', v.string())
					.field('counter', v.number(), { onUpdate: () => 'not-a-number' as any }),
			)
			expect(() =>
				validateUpdateOps(BadSchema, [new SetOp({ name: 'test' })]),
			).toThrow(OrmValidationError)
		})

		test('collects all conflicts in one error', () => {
			try {
				validateUpdateOps(UpdateSchema, [
					new SetOp({ views: 0, name: 'A' }),
					new IncOp('views', 1),
					new SetOp({ name: 'B' }),
				])
			} catch (e) {
				const err = e as OrmValidationError
				expect(err.kind).toBe('conflicting-ops')
				expect(err.failures.length).toBe(2)
			}
		})
	})
}
