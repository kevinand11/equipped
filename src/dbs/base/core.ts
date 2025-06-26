import { ClientSession, Filter, UpdateFilter } from 'mongodb'
import { ConditionalObjectKeys, DeepPartial, DistributiveOmit } from 'valleyed'

import { QueryParams, QueryResults } from '../pipes'

export type IdType = { _id: string } | { id: string }
export type Entity = { toJSON: () => Record<string, unknown> }
type ModelId<T> = T extends Model<infer Id> ? Id[keyof Id] : never
export type Model<IdKey extends IdType> = IdKey & {
	createdAt?: number
	updatedAt?: number
}

type Sort = NonNullable<QueryParams['sort']>[number]

export type Table<Id extends IdType, T extends Model<Id>, E extends Entity, Extras extends Record<string, unknown> = {}> = {
	query: (query: QueryParams) => Promise<QueryResults<E>>
	findMany: (
		filter: Filter<T>,
		options?: Options & {
			limit?: number
			sort?: Sort | Sort[]
		},
	) => Promise<E[]>
	findOne: (filter: Filter<T>, options?: Options) => Promise<E | null>
	findById: (id: ModelId<T>, options?: Options) => Promise<E | null>
	insertOne: (values: CreateInput<T>, options?: Options & { makeId?: () => string; getTime?: () => Date }) => Promise<E>
	insertMany: (values: CreateInput<T>[], options?: Options & { makeId?: (i: number) => string; getTime?: () => Date }) => Promise<E[]>
	updateMany: (filter: Filter<T>, values: UpdateInput<T>, options?: Options & { getTime?: () => Date }) => Promise<E[]>
	updateOne: (filter: Filter<T>, values: UpdateInput<T>, options?: Options & { getTime?: () => Date }) => Promise<E | null>
	updateById: (id: ModelId<T>, values: UpdateInput<T>, options?: Options & { getTime?: () => Date }) => Promise<E | null>
	upsertOne: (
		filter: Filter<T>,
		values: { insert: CreateInput<T> } | { insert: Partial<CreateInput<T>>; update: UpdateInput<T> },
		options?: Options & { makeId?: () => string; getTime?: () => Date },
	) => Promise<E>
	deleteOne: (filter: Filter<T>, options?: Options) => Promise<E | null>
	deleteById: (id: ModelId<T>, options?: Options) => Promise<E | null>
	deleteMany: (filter: Filter<T>, options?: Options) => Promise<E[]>
	bulkWrite: (operations: BulkWriteOperation<T>[], options?: Options & { getTime?: () => Date }) => Promise<void>
	readonly config: Config<T, E>
	readonly extras: Extras
}

export type Options = {
	session?: ClientSession
}

export type { Filter }

type AllKeys<T> = T extends any ? keyof T : never
export type EntityInput<T extends Model<any>> = ConditionalObjectKeys<DistributiveOmit<T, AllKeys<IdType> | keyof Model<IdType>>>

export type CreateInput<T extends Model<any>> = EntityInput<T>
// TODO: Updatefilter no type safe
export type UpdateInput<T extends Model<any>> = DistributiveOmit<UpdateFilter<CreateInput<T>>, '$setOnInsert'>

export type BulkWriteOperation<T extends Model<any>> =
	| { op: 'insert'; value: CreateInput<T>; makeId?: (i: number) => string }
	| { op: 'update'; filter: Filter<T>; value: UpdateInput<T> }
	| ({ op: 'upsert'; filter: Filter<T>; makeId?: (i: number) => string } & (
			| { insert: CreateInput<T> }
			| { insert: Partial<CreateInput<T>>; update: UpdateInput<T> }
	  ))
	| { op: 'delete'; filter: Filter<T> }

export type DbChangeCallbacks<M extends Model<IdType>, E extends Entity> = {
	created?: (data: { before: null; after: E }) => Promise<void>
	updated?: (data: { before: E; after: E; changes: DeepPartial<M> }) => Promise<void>
	deleted?: (data: { before: E; after: null }) => Promise<void>
}

export type Config<M extends Model<IdType>, E extends Entity> = {
	db: string
	col: string
	mapper: (model: M) => E
	change?: DbChangeCallbacks<M, E>
	options?: { skipAudit?: boolean }
}
