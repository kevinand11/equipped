import type { PipeOutput } from 'valleyed'

import type { Adapter, InsertOptions, PaginatedResult, RepoConfig, UpdateOptions, UpsertOptions } from '../adapters/base'
import { eq, isIn, query, where } from '../query/index'
import type { QueryOp } from '../query/types'
import { type Schema, computeSchema, validatePartialSchema, validateSchema } from '../schema/index'
import type { Association, Associations, ComputedDefs, FieldDefs, InferEntity } from '../schema/types'

export type Repo<R extends object, F extends FieldDefs, C extends ComputedDefs, A extends Associations, PK extends string & keyof F> = {
	findById(id: PipeOutput<F[PK]>): Promise<InferEntity<F, C> | null>

	findOne(...ops: QueryOp[]): Promise<InferEntity<F, C> | null>

	findMany(...ops: QueryOp[]): Promise<InferEntity<F, C>[]>

	insert(data: Record<string, unknown>, options?: InsertOptions): Promise<InferEntity<F, C>>

	insertMany(data: Record<string, unknown>[], options?: InsertOptions): Promise<InferEntity<F, C>[]>

	update(ops: QueryOp[], data: Record<string, unknown>, options?: UpdateOptions): Promise<InferEntity<F, C>[]>

	updateById(id: PipeOutput<F[PK]>, data: Record<string, unknown>, options?: UpdateOptions): Promise<InferEntity<F, C> | null>

	delete(...ops: QueryOp[]): Promise<InferEntity<F, C>[]>

	deleteById(id: PipeOutput<F[PK]>): Promise<InferEntity<F, C> | null>

	upsert(
		ops: QueryOp[],
		data: { insert: Record<string, unknown> } | { insert: Record<string, unknown>; update: Record<string, unknown> },
		options?: UpsertOptions,
	): Promise<InferEntity<F, C>>

	count(...ops: QueryOp[]): Promise<number>

	paginatedQuery(ops: QueryOp[], pagination: { page: number; limit: number; all?: boolean }): Promise<PaginatedResult<InferEntity<F, C>>>

	preload<K extends string & keyof A>(
		entity: InferEntity<F, C>,
		key: K,
		...ops: QueryOp[]
	): Promise<InferEntity<F, C> & Record<K, unknown>>

	preloadMany<K extends string & keyof A>(
		entities: InferEntity<F, C>[],
		key: K,
		...ops: QueryOp[]
	): Promise<(InferEntity<F, C> & Record<K, unknown>)[]>

	session<T>(callback: () => Promise<T>): Promise<T>

	with(adapter: Adapter<R>): Repo<R, F, C, A, PK>

	readonly schema: Schema<F, C, A, PK>

	readonly config: R
}

export function repo<
	R extends RepoConfig,
	F extends FieldDefs,
	C extends ComputedDefs,
	A extends Associations,
	PK extends string & keyof F,
>({ adapter, schema, config }: { adapter: Adapter<R>; schema: Schema<F, C, A, PK>; config: R }): Repo<R, F, C, A, PK> {
	const cast = (raw: Record<string, unknown>): InferEntity<F, C> => computeSchema(schema, raw)
	const castMany = (raws: Record<string, unknown>[]): InferEntity<F, C>[] => raws.map(cast)

	return {
		schema,
		config,

		async findById(id: PipeOutput<F[PK]>) {
			const ast = query(where(schema.primaryKey, eq(id)))
			const result = await adapter.findOne(schema, config, ast)
			return result ? cast(result) : null
		},

		async findOne(...ops: QueryOp[]) {
			const ast = query(...ops)
			const result = await adapter.findOne(schema, config, ast)
			return result ? cast(result) : null
		},

		async findMany(...ops: QueryOp[]) {
			const ast = query(...ops)
			const results = await adapter.findMany(schema, config, ast)
			return castMany(results)
		},

		async insert(data: Record<string, unknown>, options?: InsertOptions) {
			const validated = validateSchema(schema, data)
			const result = await adapter.insertOne(schema, config, validated as Record<string, unknown>, options)
			return cast(result)
		},

		async insertMany(data: Record<string, unknown>[], options?: InsertOptions) {
			const validated = data.map((d) => validateSchema(schema, d) as Record<string, unknown>)
			const results = await adapter.insertMany(schema, config, validated, options)
			return castMany(results)
		},

		async update(ops: QueryOp[], data: Record<string, unknown>, options?: UpdateOptions) {
			const validated = validatePartialSchema(schema, data)
			const ast = query(...ops)
			const results = await adapter.updateMany(schema, config, ast, validated as Record<string, unknown>, options)
			return castMany(results)
		},

		async updateById(id: PipeOutput<F[PK]>, data: Record<string, unknown>, options?: UpdateOptions) {
			const validated = validatePartialSchema(schema, data)
			const ast = query(where(schema.primaryKey, eq(id)))
			const result = await adapter.updateOne(schema, config, ast, validated as Record<string, unknown>, options)
			return result ? cast(result) : null
		},

		async delete(...ops: QueryOp[]) {
			const ast = query(...ops)
			const results = await adapter.deleteMany(schema, config, ast)
			return castMany(results)
		},

		async deleteById(id: PipeOutput<F[PK]>) {
			const ast = query(where(schema.primaryKey, eq(id)))
			const result = await adapter.deleteOne(schema, config, ast)
			return result ? cast(result) : null
		},

		async upsert(ops: QueryOp[], data, options?: UpsertOptions) {
			const validatedInsert = validateSchema(schema, data.insert) as Record<string, unknown>
			const upsertData =
				'update' in data
					? {
							insert: validatedInsert,
							update: validatePartialSchema(schema, data.update) as Record<string, unknown>,
						}
					: { insert: validatedInsert }
			const ast = query(...ops)
			const result = await adapter.upsertOne(schema, config, ast, upsertData, options)
			return cast(result)
		},

		async count(...ops: QueryOp[]) {
			const ast = query(...ops)
			return adapter.count(schema, config, ast)
		},

		async paginatedQuery(ops: QueryOp[], pagination) {
			const ast = query(...ops)
			const result = await adapter.query(schema, config, ast, {
				page: pagination.page,
				limit: pagination.limit,
				all: pagination.all ?? false,
			})
			return {
				...result,
				results: castMany(result.results),
			}
		},

		async preload<K extends string & keyof A>(entity: InferEntity<F, C>, key: K, ...ops: QueryOp[]) {
			const association = schema.associations[key] as Association
			if (!association) throw new Error(`Unknown association: ${String(key)}`)

			const loaded = await resolveAssociation(adapter, association, entity, schema.primaryKey, ops)
			return { ...entity, [key]: loaded } as InferEntity<F, C> & Record<K, unknown>
		},

		async preloadMany<K extends string & keyof A>(entities: InferEntity<F, C>[], key: K, ...ops: QueryOp[]) {
			const association = schema.associations[key] as Association
			if (!association) throw new Error(`Unknown association: ${String(key)}`)

			return batchPreload(adapter, association, entities as Record<string, unknown>[], schema.primaryKey, key, ops) as Promise<
				(InferEntity<F, C> & Record<K, unknown>)[]
			>
		},

		async session<T>(callback: () => Promise<T>): Promise<T> {
			return adapter.session(callback)
		},

		with(adapter: Adapter<R>) {
			return repo({ adapter, schema, config })
		},
	}
}

async function resolveAssociation(
	adapter: Adapter<any>,
	association: Association,
	entity: Record<string, unknown>,
	primaryKey: string,
	extraOps: QueryOp[],
): Promise<unknown> {
	const relatedSchema = association.schema()

	switch (association.type) {
		case 'belongsTo': {
			const fkValue = entity[association.foreignKey]
			if (fkValue == null) return null
			const relatedTable = { primaryKey } as any
			const ast = query(where(primaryKey, eq(fkValue)), ...extraOps)
			const result = await adapter.findOne(relatedSchema, relatedTable, ast)
			return result
		}

		case 'hasOne': {
			const pkValue = entity[primaryKey]
			const relatedTable = { primaryKey } as any
			const ast = query(where(association.foreignKey, eq(pkValue)), ...extraOps)
			const result = await adapter.findOne(relatedSchema, relatedTable, ast)
			return result
		}

		case 'hasMany': {
			const pkValue = entity[primaryKey]
			const relatedTable = { primaryKey } as any
			const ast = query(where(association.foreignKey, eq(pkValue)), ...extraOps)
			const results = await adapter.findMany(relatedSchema, relatedTable, ast)
			return results
		}

		case 'manyToMany': {
			const pkValue = entity[primaryKey]
			const joinSchema = association.joinSchema()
			const joinTable = { primaryKey } as any

			const joinAst = query(where(association.thisForeignKey, eq(pkValue)))
			const joinRecords = await adapter.findMany(joinSchema, joinTable, joinAst)

			if (joinRecords.length === 0) return []

			const relatedIds = joinRecords.map((r) => r[association.thatForeignKey])
			const relatedTable = { primaryKey } as any
			const relatedAst = query(where(primaryKey, isIn(relatedIds as string[])), ...extraOps)
			const results = await adapter.findMany(relatedSchema, relatedTable, relatedAst)
			return results
		}

		default:
			throw new Error(`Unknown association type: ${(association as any).type}`)
	}
}

async function batchPreload<K extends string>(
	adapter: Adapter<any>,
	association: Association,
	entities: Record<string, unknown>[],
	primaryKey: string,
	key: K,
	extraOps: QueryOp[],
): Promise<(Record<string, unknown> & Record<K, unknown>)[]> {
	const relatedSchema = association.schema()
	const records = entities as Record<string, unknown>[]

	switch (association.type) {
		case 'belongsTo': {
			const fkValues = [...new Set(records.map((e) => e[association.foreignKey]).filter(Boolean))]
			if (fkValues.length === 0) return entities.map((e) => ({ ...e, [key]: null })) as any

			const relatedTable = { primaryKey } as any
			const ast = query(where(primaryKey, isIn(fkValues as string[])), ...extraOps)
			const relatedRecords = await adapter.findMany(relatedSchema, relatedTable, ast)

			const lookup = new Map<unknown, Record<string, unknown>>()
			for (const r of relatedRecords) lookup.set(r[primaryKey], r)

			return entities.map((e) => ({
				...e,
				[key]: lookup.get((e as Record<string, unknown>)[association.foreignKey]) ?? null,
			})) as any
		}

		case 'hasOne': {
			const pkValues = [...new Set(records.map((e) => e[primaryKey]).filter(Boolean))]
			if (pkValues.length === 0) return entities.map((e) => ({ ...e, [key]: null })) as any

			const relatedTable = { primaryKey } as any
			const ast = query(where(association.foreignKey, isIn(pkValues as string[])), ...extraOps)
			const relatedRecords = await adapter.findMany(relatedSchema, relatedTable, ast)

			const lookup = new Map<unknown, Record<string, unknown>>()
			for (const r of relatedRecords) lookup.set(r[association.foreignKey], r)

			return entities.map((e) => ({
				...e,
				[key]: lookup.get((e as Record<string, unknown>)[primaryKey]) ?? null,
			})) as any
		}

		case 'hasMany': {
			const pkValues = [...new Set(records.map((e) => e[primaryKey]).filter(Boolean))]
			if (pkValues.length === 0) return entities.map((e) => ({ ...e, [key]: [] })) as any

			const relatedTable = { primaryKey } as any
			const ast = query(where(association.foreignKey, isIn(pkValues as string[])), ...extraOps)
			const relatedRecords = await adapter.findMany(relatedSchema, relatedTable, ast)

			const grouped = new Map<unknown, Record<string, unknown>[]>()
			for (const r of relatedRecords) {
				const fk = r[association.foreignKey]
				if (!grouped.has(fk)) grouped.set(fk, [])
				grouped.get(fk)!.push(r)
			}

			return entities.map((e) => ({
				...e,
				[key]: grouped.get((e as Record<string, unknown>)[primaryKey]) ?? [],
			})) as any
		}

		case 'manyToMany': {
			const pkValues = [...new Set(records.map((e) => e[primaryKey]).filter(Boolean))]
			if (pkValues.length === 0) return entities.map((e) => ({ ...e, [key]: [] })) as any

			const joinSchema = association.joinSchema()
			const joinTable = { primaryKey } as any

			const joinAst = query(where(association.thisForeignKey, isIn(pkValues as string[])))
			const joinRecords = await adapter.findMany(joinSchema, joinTable, joinAst)

			if (joinRecords.length === 0) return entities.map((e) => ({ ...e, [key]: [] })) as any

			const relatedIds = [...new Set(joinRecords.map((r) => r[association.thatForeignKey]))]
			const relatedTable = { primaryKey } as any
			const relatedAst = query(where(primaryKey, isIn(relatedIds as string[])), ...extraOps)
			const relatedRecords = await adapter.findMany(relatedSchema, relatedTable, relatedAst)

			const relatedLookup = new Map<unknown, Record<string, unknown>>()
			for (const r of relatedRecords) relatedLookup.set(r[primaryKey], r)

			const entityRelated = new Map<unknown, Record<string, unknown>[]>()
			for (const jr of joinRecords) {
				const thisFk = jr[association.thisForeignKey]
				const related = relatedLookup.get(jr[association.thatForeignKey])
				if (related) {
					if (!entityRelated.has(thisFk)) entityRelated.set(thisFk, [])
					entityRelated.get(thisFk)!.push(related)
				}
			}

			return entities.map((e) => ({
				...e,
				[key]: entityRelated.get((e as Record<string, unknown>)[primaryKey]) ?? [],
			})) as any
		}

		default:
			throw new Error(`Unknown association type: ${(association as any).type}`)
	}
}
