import type { AnySchema } from '../../schema'
import { validateInsert, validateUpdate, type SchemaInsertInput, type SchemaUpdateInput } from '../../schema-validations'

export function validateInsertInput<S extends AnySchema>(schema: S, data: SchemaInsertInput<S>) {
	return validateInsert(schema, data as any)
}

export function validateUpdateInput<S extends AnySchema>(schema: S, data: SchemaUpdateInput<S>) {
	return validateUpdate(schema, data)
}
