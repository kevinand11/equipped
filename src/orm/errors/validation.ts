import { EquippedError } from '../../errors'

export type OrmValidationErrorKind = 'validation' | 'conflicting-ops' | 'empty-group' | 'undeclared-op' | 'upsert-filter-incompatible' | 'aggregate'

export type OrmValidationFailure = {
	opIndex?: number
	rowIndex?: number
	field?: string
	alias?: string
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

if (import.meta.vitest) {
	const { describe, test, expect } = import.meta.vitest
	const { EquippedError } = await import('../../errors')

	describe('OrmValidationError', () => {
		describe('aggregate kind', () => {
			test('accepts aggregate as kind', () => {
				const err = new OrmValidationError('aggregate', 'orders', 'aggregate', [])
				expect(err.kind).toBe('aggregate')
			})

			test('accepts aggregate as operation', () => {
				const err = new OrmValidationError('aggregate', 'orders', 'aggregate', [])
				expect(err.operation).toBe('aggregate')
			})

			test('formats message with aggregate kind and operation', () => {
				const err = new OrmValidationError('aggregate', 'orders', 'aggregate', [])
				expect(err.message).toBe('ORM validation error (aggregate) on orders.aggregate')
			})
		})

		describe('alias carrier on failures', () => {
			test('failure entry accepts optional alias', () => {
				const failures: OrmValidationFailure[] = [
					{ alias: 'total_price', cause: 'alias collision' },
				]
				const err = new OrmValidationError('aggregate', 'orders', 'aggregate', failures)
				expect(err.failures[0].alias).toBe('total_price')
			})

			test('failure entry without alias still works', () => {
				const failures: OrmValidationFailure[] = [
					{ field: 'amount', cause: 'invalid field' },
				]
				const err = new OrmValidationError('validation', 'orders', 'createOne', failures)
				expect(err.failures[0].alias).toBeUndefined()
				expect(err.failures[0].field).toBe('amount')
			})

			test('alias is included in the error context', () => {
				const failures: OrmValidationFailure[] = [
					{ alias: 'avg_price', cause: 'having-alias-not-found' },
				]
				const err = new OrmValidationError('aggregate', 'orders', 'aggregate', failures)
				expect((err.context as any).failures[0].alias).toBe('avg_price')
			})
		})

		describe('existing kinds unchanged', () => {
			test.each([
				'validation',
				'conflicting-ops',
				'empty-group',
				'undeclared-op',
				'upsert-filter-incompatible',
			] as const)('kind %s still works', (kind) => {
				const err = new OrmValidationError(kind, 'users', 'createOne', [])
				expect(err.kind).toBe(kind)
			})
		})

		describe('instanceof discrimination', () => {
			test('aggregate error is instanceof OrmValidationError', () => {
				const err = new OrmValidationError('aggregate', 'orders', 'aggregate', [])
				expect(err).toBeInstanceOf(OrmValidationError)
			})

			test('aggregate error is instanceof EquippedError', () => {
				const err = new OrmValidationError('aggregate', 'orders', 'aggregate', [])
				expect(err).toBeInstanceOf(EquippedError)
			})
		})
	})
}
