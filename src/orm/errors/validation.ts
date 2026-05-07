import { EquippedError } from '../../errors'

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
