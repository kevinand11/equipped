import { EquippedError } from '../errors'

export type OrmValidationErrorKind = 'validation' | 'conflicting-ops' | 'empty-group' | 'undeclared-op' | 'upsert-filter-incompatible'

export type OrmValidationFailure = {
	opIndex?: number
	rowIndex?: number
	field?: string
	cause: unknown
}

export type OrmValidationOperation = 'insertOne' | 'insertMany' | 'updateOne' | 'updateMany' | 'updateByPk' | 'upsertOne'

export class OrmValidationError extends EquippedError {
	readonly kind: OrmValidationErrorKind
	readonly schema: string
	readonly operation: OrmValidationOperation
	readonly failures: OrmValidationFailure[]

	constructor({ kind, schema, operation, failures }: { kind: OrmValidationErrorKind; schema: string; operation: OrmValidationOperation; failures: OrmValidationFailure[] }) {
		super(`ORM validation failed: ${kind}`, { kind, schema, operation })
		this.kind = kind
		this.schema = schema
		this.operation = operation
		this.failures = failures
	}
}

if (import.meta.vitest) {
	const { describe, test, expect } = import.meta.vitest

	describe('OrmValidationError', () => {
		test('extends EquippedError', () => {
			const err = new OrmValidationError({
				kind: 'validation',
				schema: 'users',
				operation: 'insertOne',
				failures: [{ field: 'email', cause: new Error('invalid') }],
			})
			expect(err).toBeInstanceOf(EquippedError)
			expect(err).toBeInstanceOf(Error)
		})

		test('exposes kind, schema, operation, and failures fields', () => {
			const cause = new Error('bad value')
			const err = new OrmValidationError({
				kind: 'validation',
				schema: 'orders',
				operation: 'insertMany',
				failures: [
					{ rowIndex: 0, field: 'total', cause },
					{ rowIndex: 2, field: 'status', cause: new Error('missing') },
				],
			})
			expect(err.kind).toBe('validation')
			expect(err.schema).toBe('orders')
			expect(err.operation).toBe('insertMany')
			expect(err.failures).toHaveLength(2)
			expect(err.failures[0]).toEqual({ rowIndex: 0, field: 'total', cause })
			expect(err.failures[1].rowIndex).toBe(2)
		})

		test('kind is typed as a string-literal union', () => {
			const kinds: OrmValidationErrorKind[] = ['validation', 'conflicting-ops', 'empty-group', 'undeclared-op', 'upsert-filter-incompatible']
			for (const kind of kinds) {
				const err = new OrmValidationError({ kind, schema: 'test', operation: 'insertOne', failures: [] })
				expect(err.kind).toBe(kind)
			}
		})

		test('message includes the kind', () => {
			const err = new OrmValidationError({ kind: 'conflicting-ops', schema: 'users', operation: 'updateOne', failures: [] })
			expect(err.message).toContain('conflicting-ops')
		})
	})
}
