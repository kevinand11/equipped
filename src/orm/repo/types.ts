import type { AnyPreloadDef, PreloadedMap } from '../relations'
import type { AnySchema, SchemaOutput } from '../schema'
import type { Prettify } from '../utils'

export type Selected<S extends AnySchema, Sel extends string> = [Sel] extends [never]
	? SchemaOutput<S>
	: Prettify<Pick<SchemaOutput<S>, Sel & keyof SchemaOutput<S>>>

export type SelectedWithPreloads<S extends AnySchema, Sel extends string, P extends readonly AnyPreloadDef[]> = Prettify<
	Selected<S, Sel> & PreloadedMap<P>
>
