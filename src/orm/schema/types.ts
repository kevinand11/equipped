import type { Pipe, PipeInput, PipeOutput } from 'valleyed'

export type FieldDef = Pipe<any, any>
export type FieldDefs = Record<string, FieldDef>

export type ComputedFieldDef<P extends Pipe<any, any> = Pipe<any, any>, D = Record<string, unknown>> = {
	__kind: 'computed'
	pipe: P
	compute: (data: D) => PipeInput<P>
}

export type ComputedDefs = Record<string, ComputedFieldDef<any, any>>

export type IndexDef = {
	name: string
	fields: string[]
	unique?: boolean
}

export type Indexes = IndexDef[]

export type AssociationType = 'belongsTo' | 'hasOne' | 'hasMany' | 'manyToMany'

export type BelongsToAssociation<S = any> = {
	type: 'belongsTo'
	schema: () => AnySchema
	foreignKey: string
	_entity?: S
}

export type HasOneAssociation<S = any> = {
	type: 'hasOne'
	schema: () => AnySchema
	foreignKey: string
	_entity?: S
}

export type HasManyAssociation<S = any> = {
	type: 'hasMany'
	schema: () => AnySchema
	foreignKey: string
	_entity?: S
}

export type ManyToManyAssociation<S = any> = {
	type: 'manyToMany'
	schema: () => AnySchema
	joinSchema: () => AnySchema
	thisForeignKey: string
	thatForeignKey: string
	_entity?: S
}

export type Association = BelongsToAssociation | HasOneAssociation | HasManyAssociation | ManyToManyAssociation
export type Associations = Record<string, Association>

export type AnySchema<
	F extends FieldDefs = FieldDefs,
	C extends ComputedDefs = ComputedDefs,
	A extends Associations = Associations,
	PK extends string = string,
> = {
	readonly fields: F
	readonly computeds: C
	readonly associations: A
	readonly primaryKey: PK
	readonly indexes: Indexes
	readonly generateId: (index: number) => PK extends keyof F ? PipeOutput<F[PK]> : unknown
}

type Prettify<T> = { [K in keyof T]: T[K] } & {}

export type InferEntity<F extends FieldDefs, C extends ComputedDefs = {}> = Prettify<
	{ [K in keyof F]: PipeOutput<F[K]> } & { [K in keyof C]: C[K] extends ComputedFieldDef<infer P> ? PipeOutput<P> : never }
>

export type InferInput<F extends FieldDefs, PK extends keyof F = never> = {
	[K in Exclude<keyof F, PK>]: PipeInput<F[K]>
}

export type SchemaEntity<S> = S extends AnySchema<infer F, infer C, any, any> ? InferEntity<F, C> : never
export type SchemaInput<S> = S extends AnySchema<infer F, any, any, infer PK> ? InferInput<F, PK> : never
export type SchemaFields<S> = S extends AnySchema<infer F, any, any, any> ? keyof F : never
export type SchemaAssociationKeys<S> = S extends AnySchema<any, any, infer A, any> ? keyof A : never
export type SchemaPrimaryKeyType<S> =
	S extends AnySchema<infer F, any, any, infer PK> ? (PK extends keyof F ? PipeOutput<F[PK]> : never) : never

export type AssociationEntity<A extends Association> = A extends BelongsToAssociation
	? SchemaEntity<ReturnType<A['schema']>>
	: A extends HasOneAssociation
		? SchemaEntity<ReturnType<A['schema']>> | null
		: A extends HasManyAssociation
			? SchemaEntity<ReturnType<A['schema']>>[]
			: A extends ManyToManyAssociation
				? SchemaEntity<ReturnType<A['schema']>>[]
				: never

export type WithPreloaded<E, S extends AnySchema, K extends keyof S['associations']> = E & {
	[P in K]: AssociationEntity<S['associations'][P]>
}

export type SelectFields<E, S extends readonly (keyof E)[]> = S[number] extends never ? E : Pick<E, S[number]>

export type FieldsOf<D> = {
	[K in keyof D as D[K] extends ComputedFieldDef ? never : D[K] extends Association ? never : K]: D[K] extends FieldDef ? D[K] : never
}

export type ComputedsOf<D> = {
	[K in keyof D as D[K] extends ComputedFieldDef ? K : never]: D[K] extends ComputedFieldDef ? D[K] : never
}

export type AssociationsOf<D> = {
	[K in keyof D as D[K] extends Association ? K : never]: D[K] extends Association ? D[K] : never
}

export type SchemaRawShape<D> = {
	[K in keyof D as D[K] extends Association ? never : K]: D[K] extends Pipe<any, infer O> ? O : never
}
