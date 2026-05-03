import type { Prettify as ValleyedPrettify } from 'valleyed'

import type { ComputedField, Field, SchemaField } from './fields'
import type { OrderBy, QueryGroup, Where } from './query'
import type { AnyRelDef } from './relations'
import type { Schema } from './schema'
import type { AnyUpdateOp } from './updates'

type AnyOrmClass =
	| Field<any, any>
	| SchemaField<any, any, any>
	| ComputedField<any, any, any>
	| Schema<any, any, any>
	| AnyRelDef
	| Where
	| QueryGroup
	| OrderBy
	| AnyUpdateOp

export type Prettify<T> = T extends AnyOrmClass ? T : ValleyedPrettify<T>
