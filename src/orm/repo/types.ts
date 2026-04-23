import type { AnySchema, SchemaOutput } from '../schema'

export type Selected<S extends AnySchema, Sel extends string> = [Sel] extends [never]
	? SchemaOutput<S>
	: Pick<SchemaOutput<S>, Sel & keyof SchemaOutput<S>>
