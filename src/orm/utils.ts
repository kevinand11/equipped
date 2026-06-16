import type { Prettify as ValleyedPrettify } from 'valleyed'

import type { ComputedField, Field, SchemaField } from './fields'
import type { Filter, FilterGroup } from './filter'
import type { OrderBy } from './query-options'
import type { AnyRelDef } from './relations'
import type { Schema } from './schema'
import type { AnyUpdateOp } from './updates'

type AnyOrmClass =
	| Field<any, any>
	| SchemaField<any, any, any>
	| ComputedField<any, any, any>
	| Schema<any, any, any>
	| AnyRelDef
	| Filter
	| FilterGroup
	| OrderBy
	| AnyUpdateOp

export type Prettify<T> = T extends AnyOrmClass ? T : ValleyedPrettify<T>
