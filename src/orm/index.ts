export { computeSchema, schema, Schema, validatePartialSchema, validateSchema } from './schema/index'
export type {
	AnySchema,
	Association,
	AssociationEntity,
	Associations,
	AssociationsOf,
	AssociationType,
	BelongsToAssociation,
	ComputedDefs,
	ComputedFieldDef,
	ComputedsOf,
	FieldDef,
	FieldDefs,
	FieldsOf,
	HasManyAssociation,
	HasOneAssociation,
	IndexDef,
	Indexes,
	InferEntity,
	InferInput,
	ManyToManyAssociation,
	SchemaAssociationKeys,
	SchemaEntity,
	SchemaFields,
	SchemaInput,
	SchemaPrimaryKeyType,
	SchemaRawShape,
	SelectFields,
	WithPreloaded,
} from './schema/types'

export {
	and,
	eq,
	exists,
	gt,
	gte,
	isIn,
	like,
	limit,
	lt,
	lte,
	ne,
	notExists,
	notIn,
	offset,
	or,
	orderBy,
	query,
	raw,
	select,
	where,
} from './query/index'
export { Condition } from './query/types'
export type { AndOp, LimitOp, OffsetOp, OrderByOp, OrOp, QueryAST, QueryOp, RawOp, SelectOp, WhereOp } from './query/types'

export { MongoAdapter } from './adapters/mongo/index'
export type { MongoAdapterConfig, MongoTableConfig } from './adapters/mongo/index'
export { PgAdapter } from './adapters/pg/index'
export type { PgAdapterConfig, PgClient, PgPool, PgTableConfig } from './adapters/pg/index'
export type {
	Adapter,
	TableConfig as BaseTableConfig,
	InsertOptions,
	PaginatedResult,
	UpdateOptions,
	UpsertOptions,
} from './adapters/types'

export { repo, type Repo } from './repo/index'
