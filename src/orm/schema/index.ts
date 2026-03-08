import type { Pipe, PipeInput } from 'valleyed'
import { v } from 'valleyed'

import type {
	Associations,
	BelongsToAssociation,
	ComputedDefs,
	ComputedFieldDef,
	FieldDef,
	FieldDefs,
	HasManyAssociation,
	HasOneAssociation,
	IndexDef,
	Indexes,
	InferEntity,
	ManyToManyAssociation,
	Schema,
	SchemaEntity,
	SchemaRawShape,
} from './types'

export class SchemaBuilder<
	F extends FieldDefs = FieldDefs,
	C extends ComputedDefs = ComputedDefs,
	A extends Associations = Associations,
	PK extends string = string,
> {
	readonly fields: F
	readonly computeds: C
	readonly associations: A
	readonly primaryKey: PK
	readonly indexes: Indexes
	readonly generateId: (index: number) => unknown

	constructor(
		fields: F,
		computeds: C,
		associations: A,
		primaryKey: PK,
		indexes: Indexes = [],
		generateId: (index: number) => unknown = () => '',
	) {
		this.fields = fields
		this.computeds = computeds
		this.associations = associations
		this.primaryKey = primaryKey
		this.indexes = indexes
		this.generateId = generateId
	}

	pk<K extends string & keyof F>(key: K, generate: (index: number) => import('valleyed').PipeOutput<F[K]>): SchemaBuilder<F, C, A, K> {
		return new SchemaBuilder(this.fields, this.computeds, this.associations, key, this.indexes, generate)
	}

	index(name: string, fields: (keyof F & string)[], options?: { unique?: boolean }): SchemaBuilder<F, C, A, PK> {
		const def: IndexDef = { name, fields, unique: options?.unique }
		return new SchemaBuilder(this.fields, this.computeds, this.associations, this.primaryKey, [...this.indexes, def], this.generateId)
	}

	computed<K extends string, P extends Pipe<any, any>>(
		key: K,
		pipe: P,
		compute: (data: SchemaRawShape<F>) => PipeInput<P>,
	): SchemaBuilder<F, C & Record<K, ComputedFieldDef<P, SchemaRawShape<F>>>, A, PK> {
		const def: ComputedFieldDef<P, SchemaRawShape<F>> = { __kind: 'computed', pipe, compute }
		return new SchemaBuilder(
			this.fields,
			{ ...this.computeds, [key]: def } as C & Record<K, ComputedFieldDef<P, SchemaRawShape<F>>>,
			this.associations,
			this.primaryKey,
			this.indexes,
			this.generateId,
		)
	}

	belongsTo<K extends string, S extends Schema>(
		key: K,
		schemaFn: () => S,
		foreignKey: string,
	): SchemaBuilder<F, C, A & Record<K, BelongsToAssociation<SchemaEntity<S>>>, PK> {
		const def: BelongsToAssociation<SchemaEntity<S>> = { type: 'belongsTo', schema: schemaFn, foreignKey }
		return new SchemaBuilder(
			this.fields,
			this.computeds,
			{ ...this.associations, [key]: def } as A & Record<K, BelongsToAssociation<SchemaEntity<S>>>,
			this.primaryKey,
			this.indexes,
			this.generateId,
		)
	}

	hasOne<K extends string, S extends Schema>(
		key: K,
		schemaFn: () => S,
		foreignKey: string,
	): SchemaBuilder<F, C, A & Record<K, HasOneAssociation<SchemaEntity<S>>>, PK> {
		const def: HasOneAssociation<SchemaEntity<S>> = { type: 'hasOne', schema: schemaFn, foreignKey }
		return new SchemaBuilder(
			this.fields,
			this.computeds,
			{ ...this.associations, [key]: def } as A & Record<K, HasOneAssociation<SchemaEntity<S>>>,
			this.primaryKey,
			this.indexes,
			this.generateId,
		)
	}

	hasMany<K extends string, S extends Schema>(
		key: K,
		schemaFn: () => S,
		foreignKey: string,
	): SchemaBuilder<F, C, A & Record<K, HasManyAssociation<SchemaEntity<S>>>, PK> {
		const def: HasManyAssociation<SchemaEntity<S>> = { type: 'hasMany', schema: schemaFn, foreignKey }
		return new SchemaBuilder(
			this.fields,
			this.computeds,
			{ ...this.associations, [key]: def } as A & Record<K, HasManyAssociation<SchemaEntity<S>>>,
			this.primaryKey,
			this.indexes,
			this.generateId,
		)
	}

	manyToMany<K extends string, S extends Schema, J extends Schema>(
		key: K,
		schemaFn: () => S,
		joinSchemaFn: () => J,
		thisForeignKey: string,
		thatForeignKey: string,
	): SchemaBuilder<F, C, A & Record<K, ManyToManyAssociation<SchemaEntity<S>>>, PK> {
		const def: ManyToManyAssociation<SchemaEntity<S>> = {
			type: 'manyToMany',
			schema: schemaFn,
			joinSchema: joinSchemaFn,
			thisForeignKey,
			thatForeignKey,
		}
		return new SchemaBuilder(
			this.fields,
			this.computeds,
			{ ...this.associations, [key]: def } as A & Record<K, ManyToManyAssociation<SchemaEntity<S>>>,
			this.primaryKey,
			this.indexes,
			this.generateId,
		)
	}
}

export function schema<const D extends Record<string, FieldDef>>(defs: D): SchemaBuilder<D, {}, {}, string> {
	return new SchemaBuilder<D, {}, {}, string>(defs as D, {} as {}, {} as {}, '' as string)
}

export function validateSchema<F extends FieldDefs>(
	schema: Schema<F, any, any, any>,
	data: Record<string, unknown>,
): { [K in keyof F]: import('valleyed').PipeOutput<F[K]> } {
	const fieldsWithoutPk = Object.fromEntries(Object.entries(schema.fields).filter(([key]) => key !== schema.primaryKey))
	const pipe = v.object(fieldsWithoutPk)
	const validated = v.assert(pipe, data) as Record<string, unknown>

	const pkField = schema.fields[schema.primaryKey]
	if (pkField && schema.primaryKey in data) {
		validated[schema.primaryKey] = v.assert(pkField, data[schema.primaryKey])
	}

	return validated as { [K in keyof F]: import('valleyed').PipeOutput<F[K]> }
}

export function computeSchema<F extends FieldDefs, C extends ComputedDefs>(
	schema: Schema<F, C, any, any>,
	data: Record<string, unknown>,
): InferEntity<F, C> {
	const computedEntries = Object.entries(schema.computeds)
	if (computedEntries.length > 0) {
		const computedData = Object.fromEntries(computedEntries.map(([key, def]) => [key, def.compute(data)]))
		const computedPipes = Object.fromEntries(computedEntries.map(([key, def]) => [key, def.pipe]))
		const computedPipe = v.object(computedPipes)
		Object.assign(data, v.assert(computedPipe, computedData))
	}
	return data as InferEntity<F, C>
}

export function validatePartialSchema<F extends FieldDefs, C extends ComputedDefs>(
	schema: Schema<F, C, any, any>,
	data: Record<string, unknown>,
): Partial<InferEntity<F, C>> {
	const knownKeys = Object.keys(schema.fields)
	const presentKeys = Object.keys(data).filter((key) => knownKeys.includes(key) && !(key in schema.computeds))
	const branches = Object.fromEntries(presentKeys.map((key) => [key, schema.fields[key]])) as Record<string, FieldDef>
	if (Object.keys(branches).length === 0) return {} as Partial<InferEntity<F, C>>
	const pipe = v.object(branches)
	return v.assert(pipe, data) as Partial<InferEntity<F, C>>
}
