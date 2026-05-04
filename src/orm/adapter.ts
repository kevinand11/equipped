import type { PipeOutput } from 'valleyed'

import type { OrmUse } from './adapters/base'
import type { SchemaField } from './fields'
import type { FilterGroup } from './filter'
import type { QueryOptions } from './query'
import type { AnySchema, SchemaFields } from './schema'
import type { AnyUpdateOp } from './updates'

export type FieldTypeName = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array' | 'date'
export type FilterOpName =
	| 'eq'
	| 'ne'
	| 'gt'
	| 'gte'
	| 'lt'
	| 'lte'
	| 'in'
	| 'notIn'
	| 'like'
	| 'exists'
	| 'notExists'
	| 'contains'
	| 'notContains'
export type UpdateOpName = 'set' | 'inc' | 'mul' | 'min' | 'max' | 'unset' | 'push' | 'pull' | 'patch' | 'upsert'

export type CrudBag<Config> = {
	findByPk?: (schema: AnySchema, config: Config, pk: unknown) => Promise<Record<string, unknown> | null>
	insertMany?: (schema: AnySchema, config: Config, data: Record<string, unknown>[]) => Promise<Record<string, unknown>[]>
	updateByPk?: (
		schema: AnySchema,
		config: Config,
		pk: unknown,
		ops: AnyUpdateOp[],
	) => Promise<Record<string, unknown> | null>
	deleteByPk?: (schema: AnySchema, config: Config, pk: unknown) => Promise<Record<string, unknown> | null>
	raw?: <T = unknown>(schema: AnySchema, config: Config, command: unknown, params?: unknown[]) => Promise<T>
}

export type QueryableBag<Config> = {
	findMany?: (
		schema: AnySchema,
		config: Config,
		filter: FilterGroup,
		options?: QueryOptions,
	) => Promise<Record<string, unknown>[]>
	updateMany?: (
		schema: AnySchema,
		config: Config,
		filter: FilterGroup,
		data: Record<string, unknown>,
	) => Promise<Record<string, unknown>[]>
	deleteMany?: (schema: AnySchema, config: Config, filter: FilterGroup) => Promise<Record<string, unknown>[]>
	upsertOne?: (
		schema: AnySchema,
		config: Config,
		filter: FilterGroup,
		insert: Record<string, unknown>,
		ops: AnyUpdateOp[],
	) => Promise<Record<string, unknown>>
}

export type LifecycleBag = {
	connect?: () => Promise<void>
	disconnect?: () => Promise<void>
}

export type TransactionalBag = {
	session?: <T>(fn: () => Promise<T>) => Promise<T>
}

type UniqueArray<T extends readonly unknown[]> = T extends readonly [infer H, ...infer R]
	? H extends R[number]
		? never
		: readonly [H, ...UniqueArray<R>]
	: T

type InferConfig<Acc> = 'config' extends keyof Acc ? Acc['config'] : unknown

export class AdapterBuilder<Acc = {}> {
	#data: Record<string, unknown> = {
		supportedFieldTypes: [] as readonly FieldTypeName[],
		queryableOps: [] as readonly FilterOpName[],
		updateOps: [] as readonly UpdateOpName[],
	}

	config<C>(_witness: 'config' extends keyof Acc ? never : C): AdapterBuilder<Acc & { config: C }> {
		return this as any
	}

	supportedFieldTypes<const T extends readonly FieldTypeName[]>(
		...types: 'supportedFieldTypes' extends keyof Acc ? [never] : T & UniqueArray<T>
	): AdapterBuilder<Acc & { supportedFieldTypes: T }> {
		this.#data.supportedFieldTypes = types
		return this as any
	}

	queryableOps<const T extends readonly FilterOpName[]>(
		...ops: 'queryableOps' extends keyof Acc ? [never] : T & UniqueArray<T>
	): AdapterBuilder<Acc & { queryableOps: T }> {
		this.#data.queryableOps = ops
		return this as any
	}

	updateOps<const T extends readonly UpdateOpName[]>(
		...ops: 'updateOps' extends keyof Acc ? [never] : T & UniqueArray<T>
	): AdapterBuilder<Acc & { updateOps: T }> {
		this.#data.updateOps = ops
		return this as any
	}

	lifecycle(bag: 'lifecycle' extends keyof Acc ? never : LifecycleBag): AdapterBuilder<Acc & { lifecycle: typeof bag }> {
		this.#data.lifecycle = bag
		return this as any
	}

	crud<B extends CrudBag<InferConfig<Acc>>>(bag: 'crud' extends keyof Acc ? never : B): AdapterBuilder<Acc & { crud: B }> {
		this.#data.crud = bag
		return this as any
	}

	queryable<B extends QueryableBag<InferConfig<Acc>>>(
		bag: 'queryable' extends keyof Acc
			? never
			: 'queryableOps' extends keyof Acc
				? Acc['queryableOps'] extends readonly [FilterOpName, ...FilterOpName[]]
					? B
					: never
				: never,
	): AdapterBuilder<Acc & { queryable: B }> {
		if (!(this.#data.queryableOps as readonly FilterOpName[])?.length) {
			throw new Error('defineAdapter: .queryable() requires .queryableOps() to be called first with a non-empty list')
		}
		this.#data.queryable = bag
		return this as any
	}

	transactional<B extends TransactionalBag>(
		bag: 'transactional' extends keyof Acc ? never : B,
	): AdapterBuilder<Acc & { transactional: B }> {
		this.#data.transactional = bag
		return this as any
	}

	_build() {
		return this.#data
	}
}

export type AdapterResult<Acc> = {
	readonly supportedFieldTypes: 'supportedFieldTypes' extends keyof Acc ? Acc['supportedFieldTypes'] : readonly []
	readonly queryableOps: 'queryableOps' extends keyof Acc ? Acc['queryableOps'] : readonly []
	readonly updateOps: 'updateOps' extends keyof Acc ? Acc['updateOps'] : readonly []
	readonly crud: 'crud' extends keyof Acc ? Acc['crud'] : undefined
	readonly queryable: 'queryable' extends keyof Acc ? Acc['queryable'] : undefined
	readonly transactional: 'transactional' extends keyof Acc ? Acc['transactional'] : undefined
	readonly lifecycle: 'lifecycle' extends keyof Acc ? Acc['lifecycle'] : undefined
	use(schema: AnySchema, config: InferConfig<Acc>): OrmUse
	connect(): Promise<void>
	disconnect(): Promise<void>
	session<T>(fn: () => Promise<T>): Promise<T>
} & ('config' extends keyof Acc ? { readonly __config: Acc['config'] } : {})

export function defineAdapter<Acc>(build: (b: AdapterBuilder) => AdapterBuilder<Acc>): AdapterResult<Acc> {
	const builder = build(new AdapterBuilder())
	const data = builder._build() as AdapterResult<Acc>

	const result: Record<string, unknown> = { ...data }

	const crud = data.crud as CrudBag<any> | undefined
	const queryable = data.queryable as QueryableBag<any> | undefined
	const transactional = data.transactional as TransactionalBag | undefined
	const lifecycle = data.lifecycle as LifecycleBag | undefined

	result.use = function (schema: AnySchema, config: any): OrmUse {
		const use: OrmUse = {
			findMany: (filter, opts) =>
				queryable?.findMany?.(schema, config, filter, opts) ?? Promise.resolve([]),
			findOne: async (filter) => {
				const rows = await use.findMany(filter, { limit: 1 })
				return rows[0] ?? null
			},
			insertOne: async (d) => {
				const rows = await use.insertMany([d])
				return rows[0]
			},
			insertMany: (d) => crud?.insertMany?.(schema, config, d) ?? Promise.resolve([]),
			updateMany: (filter, d) =>
				queryable?.updateMany?.(schema, config, filter, d) ?? Promise.resolve([]),
			updateOne: async (filter, d) => {
				const rows = await use.updateMany(filter, d)
				return rows[0] ?? null
			},
			upsertOne: (filter, insert, ops) =>
				queryable?.upsertOne?.(schema, config, filter, insert, ops) ?? Promise.reject(new Error('upsertOne not implemented')),
			deleteOne: async (filter) => {
				const row = await use.findOne(filter)
				if (!row) return null
				const pk = schema.pkField.name
				if (crud?.deleteByPk) {
					await crud.deleteByPk(schema, config, row[pk])
				} else if (queryable?.deleteMany) {
					await queryable.deleteMany(schema, config, filter)
				}
				return row
			},
			deleteMany: (filter) =>
				queryable?.deleteMany?.(schema, config, filter) ?? Promise.resolve([]),
			raw: <T = unknown>(command: unknown, params?: unknown[]) =>
				(crud?.raw?.(schema, config, command, params) ?? Promise.reject(new Error('raw not implemented'))) as Promise<T>,
		}
		return use
	}

	result.connect = async () => lifecycle?.connect?.()
	result.disconnect = async () => lifecycle?.disconnect?.()
	result.session = <T>(fn: () => Promise<T>): Promise<T> =>
		transactional?.session?.(fn) ?? fn()

	return result as AdapterResult<Acc>
}

export type InferAdapterConfig<A> = A extends { __config: infer C }
	? C
	: A extends { use: (schema: any, config: infer C) => any }
		? C
		: never

export type InferAdapterQueryableOps<A> = A extends { queryableOps: infer Ops extends readonly FilterOpName[] }
	? Ops
	: readonly []

type ToFieldTypeName<T> = T extends undefined
	? never
	: T extends string
		? 'string'
		: T extends number
			? 'number'
			: T extends boolean
				? 'boolean'
				: T extends null
					? 'null'
					: T extends readonly any[]
						? 'array'
						: T extends Date
							? 'date'
							: T extends Record<string, any>
								? 'object'
								: never

type SchemaFieldTypeNames<S extends AnySchema> = {
	[K in keyof SchemaFields<S>]: SchemaFields<S>[K] extends SchemaField<any, infer P, any> ? ToFieldTypeName<PipeOutput<P>> : never
}[keyof SchemaFields<S>]

export type SchemaCompatible<A, S extends AnySchema> = A extends { supportedFieldTypes: readonly (infer FT)[] }
	? [SchemaFieldTypeNames<S>] extends [FT]
		? S
		: never
	: S

if (import.meta.vitest) {
	const { describe, test, expectTypeOf } = import.meta.vitest
	const { v } = await import('valleyed')
	const { defineSchema } = await import('./schema')

	describe('type-level: defineAdapter builder uniqueness', () => {
		test('duplicate .queryableOps values is a TS error', () => {
			const validAdapter = defineAdapter((a) => a.config({} as { prefix: string }).queryableOps('eq', 'ne'))
			expectTypeOf(validAdapter.queryableOps).toEqualTypeOf<readonly ['eq', 'ne']>()

			// @ts-expect-error — duplicate 'eq' in queryableOps should fail
			defineAdapter((a) => a.queryableOps('eq', 'eq'))
		})

		test('duplicate .supportedFieldTypes values is a TS error', () => {
			// @ts-expect-error — duplicate 'string' should fail
			defineAdapter((a) => a.supportedFieldTypes('string', 'string'))
		})
	})

	describe('type-level: SchemaCompatible', () => {
		test('adapter with empty supportedFieldTypes rejects any schema', () => {
			const _emptyAdapter = defineAdapter((a) => a.config({} as { prefix: string }).crud({ findByPk: async () => null }))
			const _TestSchema = defineSchema('test', (s) => s.pk('id', v.string(), () => 'x'))

			type Result = SchemaCompatible<typeof _emptyAdapter, typeof _TestSchema>
			expectTypeOf<Result>().toBeNever()
		})

		test('adapter with matching supportedFieldTypes accepts schema', () => {
			const _adapter = defineAdapter((a) =>
				a.config({} as { prefix: string }).supportedFieldTypes('string').crud({ findByPk: async () => null }),
			)
			const _TestSchema = defineSchema('test', (s) => s.pk('id', v.string(), () => 'x'))

			type Result = SchemaCompatible<typeof _adapter, typeof _TestSchema>
			expectTypeOf<Result>().toEqualTypeOf<typeof _TestSchema>()
		})

		test('adapter missing required field type rejects schema', () => {
			const _stringOnlyAdapter = defineAdapter((a) =>
				a.config({} as { prefix: string }).supportedFieldTypes('string').crud({ findByPk: async () => null }),
			)
			const _SchemaWithNumber = defineSchema('nums', (s) => s.pk('id', v.string(), () => 'x').field('age', v.number()))

			type Result = SchemaCompatible<typeof _stringOnlyAdapter, typeof _SchemaWithNumber>
			expectTypeOf<Result>().toBeNever()
		})
	})

}
