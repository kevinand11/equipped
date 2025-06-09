import { ClientSession, Filter, UpdateFilter } from 'mongodb'
import { DataClass } from 'valleyed'

import { QueryParams, QueryResults } from '../../schemas/db'
import { DistributiveOmit } from '../../types'

export type IdType = { _id: string } | { id: string }
export type Entity = DataClass<any, any>
type ModelId<T> = T extends Model<infer Id> ? Id[keyof Id] : never
export type Model<IdKey extends IdType> = IdKey & {
	createdAt?: number
	updatedAt?: number
}

type Sort<T extends Model<any>> = NonNullable<QueryParams<T>['sort']>[number]

export type Table<Id extends IdType, T extends Model<Id>, Transform = T, Extras extends Record<string, unknown> = {}> = {
	query: (query: QueryParams) => Promise<QueryResults<Transform>>
	findMany: (
		filter: Filter<T>,
		options?: Options & {
			limit?: number
			sort?: Sort<T> | Sort<T>[]
		},
	) => Promise<Transform[]>
	findOne: (filter: Filter<T>, options?: Options) => Promise<Transform | null>
	findById: (id: ModelId<T>, options?: Options) => Promise<Transform | null>
	insertOne: (values: CreateInput<T>, options?: Options & { makeId?: () => string; getTime?: () => Date }) => Promise<Transform>
	insertMany: (
		values: CreateInput<T>[],
		options?: Options & { makeId?: (i: number) => string; getTime?: () => Date },
	) => Promise<Transform[]>
	updateMany: (filter: Filter<T>, values: UpdateInput<T>, options?: Options & { getTime?: () => Date }) => Promise<Transform[]>
	updateOne: (filter: Filter<T>, values: UpdateInput<T>, options?: Options & { getTime?: () => Date }) => Promise<Transform | null>
	updateById: (id: ModelId<T>, values: UpdateInput<T>, options?: Options & { getTime?: () => Date }) => Promise<Transform | null>
	upsertOne: (
		filter: Filter<T>,
		values: { insert: CreateInput<T> } | { insert: Partial<CreateInput<T>>; update: UpdateInput<T> },
		options?: Options & { makeId?: () => string; getTime?: () => Date },
	) => Promise<Transform>
	deleteOne: (filter: Filter<T>, options?: Options) => Promise<Transform | null>
	deleteById: (id: ModelId<T>, options?: Options) => Promise<Transform | null>
	deleteMany: (filter: Filter<T>, options?: Options) => Promise<Transform[]>
	bulkWrite: (operations: BulkWriteOperation<T>[], options?: Options & { getTime?: () => Date }) => Promise<void>
	extras: Extras
}

export type Options = {
	session?: ClientSession
}

export type { Filter }

type AllKeys<T> = T extends any ? keyof T : never
export type EntityInput<T extends Model<any>> = DistributiveOmit<T, AllKeys<IdType> | keyof Model<IdType>>

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
