import type { InsertOptions, Orm, PaginatedResult, RepoConfig, UpdateOptions, UpsertOptions } from '../adapters/base'
import { eq, isIn, query, where } from '../query/index'
import type { QueryOp } from '../query/types'
import { type Schema, computeSchema, validatePartialSchema, validateSchema } from '../schema/index'
import type { Association, SchemaAssociationKeys, SchemaEntity, SchemaInput, SchemaPrimaryKeyType } from '../schema/types'

export type Repo<R extends object, S extends Schema<any, any, any, any>> = {
	findById(id: SchemaPrimaryKeyType<S>): Promise<SchemaEntity<S> | null>

	findOne(...ops: QueryOp[]): Promise<SchemaEntity<S> | null>

	findMany(...ops: QueryOp[]): Promise<SchemaEntity<S>[]>

	insert(data: SchemaInput<S>, options?: InsertOptions): Promise<SchemaEntity<S>>

	insertMany(data: SchemaInput<S>[], options?: InsertOptions): Promise<SchemaEntity<S>[]>

	update(ops: QueryOp[], data: Record<string, unknown>, options?: UpdateOptions): Promise<SchemaEntity<S>[]>

	updateById(id: SchemaPrimaryKeyType<S>, data: Record<string, unknown>, options?: UpdateOptions): Promise<SchemaEntity<S> | null>

	delete(...ops: QueryOp[]): Promise<SchemaEntity<S>[]>

	deleteById(id: SchemaPrimaryKeyType<S>): Promise<SchemaEntity<S> | null>

	upsert(
		ops: QueryOp[],
		data: { insert: Record<string, unknown> } | { insert: Record<string, unknown>; update: Record<string, unknown> },
		options?: UpsertOptions,
	): Promise<SchemaEntity<S>>

	paginatedQuery(ops: QueryOp[], pagination: { page: number; limit: number; all?: boolean }): Promise<PaginatedResult<SchemaEntity<S>>>

	preload<K extends SchemaAssociationKeys<S>>(
		entity: SchemaEntity<S>,
		key: K,
		...ops: QueryOp[]
	): Promise<SchemaEntity<S> & Record<K, unknown>>

	preloadMany<K extends SchemaAssociationKeys<S>>(
		entities: SchemaEntity<S>[],
		key: K,
		...ops: QueryOp[]
	): Promise<(SchemaEntity<S> & Record<K, unknown>)[]>

	session<T>(callback: () => Promise<T>): Promise<T>

	with(adapter: Orm<R>): Repo<R, S>

	readonly schema: S

	readonly config: R
}

export function repo<R extends RepoConfig, S extends Schema<any, any, any, any>>({
	adapter,
	schema,
	config,
}: {
	adapter: Orm<R>
	schema: S
	config: R
}): Repo<R, S> {
	const cast = (raw: Record<string, unknown>): SchemaEntity<S> => computeSchema(schema, raw)
	const castMany = (raws: Record<string, unknown>[]): SchemaEntity<S>[] => raws.map(cast)

	const use = adapter.use(schema, config)

	return {
		schema,
		config,

		async findById(id: SchemaPrimaryKeyType<S>) {
			const ast = query(where(schema.primaryKey, eq(id)))
			const result = await use.findOne(ast)
			return result ? cast(result) : null
		},

		async findOne(...ops: QueryOp[]) {
			const ast = query(...ops)
			const result = await use.findOne(ast)
			return result ? cast(result) : null
		},

		async findMany(...ops: QueryOp[]) {
			const ast = query(...ops)
			const results = await use.findMany(ast)
			return castMany(results)
		},

		async insert(data: Record<string, unknown>, options?: InsertOptions) {
			const validated = validateSchema(schema, data)
			const result = await use.insertOne(validated, options)
			return cast(result)
		},

		async insertMany(data: Record<string, unknown>[], options?: InsertOptions) {
			const validated = data.map((d) => validateSchema(schema, d))
			const results = await use.insertMany(validated, options)
			return castMany(results)
		},

		async update(ops: QueryOp[], data: Record<string, unknown>, options?: UpdateOptions) {
			const validated = validatePartialSchema(schema, data)
			const ast = query(...ops)
			const results = await use.updateMany(ast, validated, options)
			return castMany(results)
		},

		async updateById(id: SchemaPrimaryKeyType<S>, data: Record<string, unknown>, options?: UpdateOptions) {
			const validated = validatePartialSchema(schema, data)
			const ast = query(where(schema.primaryKey, eq(id)))
			const result = await use.updateOne(ast, validated, options)
			return result ? cast(result) : null
		},

		async delete(...ops: QueryOp[]) {
			const ast = query(...ops)
			const results = await use.deleteMany(ast)
			return castMany(results)
		},

		async deleteById(id: SchemaPrimaryKeyType<S>) {
			const ast = query(where(schema.primaryKey, eq(id)))
			const result = await use.deleteOne(ast)
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
			const result = await use.upsertOne(ast, upsertData, options)
			return cast(result)
		},

		async paginatedQuery(ops: QueryOp[], pagination) {
			const ast = query(...ops)
			const result = await use.query(ast, {
				page: pagination.page,
				limit: pagination.limit,
				all: pagination.all ?? false,
			})
			return {
				...result,
				results: castMany(result.results),
			}
		},

		async preload<K extends SchemaAssociationKeys<S>>(entity: SchemaEntity<S>, key: K, ...ops: QueryOp[]) {
			const association = schema.associations[key] as Association
			if (!association) throw new Error(`Unknown association: ${String(key)}`)

			const loaded = await resolveAssociation(adapter, association, entity, schema.primaryKey, ops)
			return { ...entity, [key]: loaded } as SchemaEntity<S> & Record<K, unknown>
		},

		async preloadMany<K extends SchemaAssociationKeys<S>>(entities: SchemaEntity<S>[], key: K, ...ops: QueryOp[]) {
			const association = schema.associations[key] as Association
			if (!association) throw new Error(`Unknown association: ${String(key)}`)

			return batchPreload(adapter, association, entities as Record<string, unknown>[], schema.primaryKey, key, ops) as Promise<
				(SchemaEntity<S> & Record<K, unknown>)[]
			>
		},

		async session<T>(callback: () => Promise<T>): Promise<T> {
			return adapter.session(callback)
		},

		with(adapter: Orm<R>) {
			return repo({ adapter, schema, config })
		},
	}
}

async function resolveAssociation(
	adapter: Orm<any>,
	association: Association,
	entity: Record<string, unknown>,
	primaryKey: string,
	extraOps: QueryOp[],
): Promise<unknown> {
	const relatedSchema = association.schema()
	const relatedTable = { primaryKey } as any

	const use = adapter.use(relatedSchema, relatedTable)

	switch (association.type) {
		case 'belongsTo': {
			const fkValue = entity[association.foreignKey]
			if (fkValue == null) return null
			const ast = query(where(primaryKey, eq(fkValue)), ...extraOps)
			const result = await use.findOne(ast)
			return result
		}

		case 'hasOne': {
			const pkValue = entity[primaryKey]
			const ast = query(where(association.foreignKey, eq(pkValue)), ...extraOps)
			const result = await use.findOne(ast)
			return result
		}

		case 'hasMany': {
			const pkValue = entity[primaryKey]
			const ast = query(where(association.foreignKey, eq(pkValue)), ...extraOps)
			const results = await use.findMany(ast)
			return results
		}

		case 'manyToMany': {
			const pkValue = entity[primaryKey]
			//const joinSchema = association.joinSchema()
			//const joinTable = { primaryKey } as any

			const joinAst = query(where(association.thisForeignKey, eq(pkValue)))
			const joinRecords = await use.findMany(joinAst)

			if (joinRecords.length === 0) return []

			const relatedIds = joinRecords.map((r) => r[association.thatForeignKey])
			const relatedTable = { primaryKey } as any
			const relatedAst = query(where(primaryKey, isIn(relatedIds as string[])), ...extraOps)
			const results = await use.findMany(relatedSchema, relatedTable, relatedAst)
			return results
		}

		default:
			throw new Error(`Unknown association type: ${(association as any).type}`)
	}
}

async function batchPreload<K extends string>(
	adapter: Orm<any>,
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
