import type { Prettify as ValleyedPrettify } from 'valleyed'

import type { Field, SchemaField } from './fields'
import type { AndOp, OrderByOp, OrOp, RawOp, WhereOp } from './query'
import type { AnyRelDef, Relations } from './relations'
import type { Schema } from './schema'
import type { AnyUpdateOp } from './updates'

type AnyOrmClass =
	| Field<any, any>
	| SchemaField<any, any, any>
	| Schema<any, any, any>
	| Relations<any, any>
	| AnyRelDef
	| WhereOp
	| AndOp
	| OrOp
	| RawOp
	| OrderByOp
	| AnyUpdateOp

export type Prettify<T> = T extends AnyOrmClass ? T : ValleyedPrettify<T>
