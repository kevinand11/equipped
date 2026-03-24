import { WhereOp, AndOp, OrOp, Condition } from '../../query'
import type { FilterOp, QueryFilter, QueryOptions } from '../../query'
import { IncOp, MulOp, MinOp, MaxOp, UnsetOp, PushOp, PullOp, PatchOp } from '../../updates'

type MongoFilter = Record<string, unknown>

export function compileMongoQuery(
	filter: QueryFilter,
	options: QueryOptions | undefined,
	primaryKey: string,
): {
	filter: MongoFilter
	sort: Record<string, 1 | -1> | undefined
	limit: number | undefined
	skip: number | undefined
	projection: Record<string, 1> | undefined
} {
	const clauses: MongoFilter[] = []

	for (const w of filter.wheres) {
		clauses.push(compileWhere(w, primaryKey))
	}

	for (const a of filter.ands) {
		const compiled = compileAnd(a, primaryKey)
		if (compiled) clauses.push(compiled)
	}

	for (const o of filter.ors) {
		const compiled = compileOr(o, primaryKey)
		if (compiled) clauses.push(compiled)
	}

	let mongoFilter: MongoFilter = {}
	if (clauses.length === 1) {
		mongoFilter = clauses[0]
	} else if (clauses.length > 1) {
		mongoFilter = { $and: clauses }
	}

	const orderBys = options?.orderBy ?? []
	const sort =
		orderBys.length > 0
			? Object.fromEntries(orderBys.map((o) => [mapField(o.field, primaryKey), o.direction === 'desc' ? -1 : 1]))
			: undefined

	const selects = options?.select ?? []
	const projection = selects.length > 0 ? Object.fromEntries(selects.map((f) => [mapField(f, primaryKey), 1])) : undefined

	return {
		filter: mongoFilter,
		sort: sort as Record<string, 1 | -1> | undefined,
		limit: options?.limit ?? undefined,
		skip: options?.offset ?? undefined,
		projection: projection as Record<string, 1> | undefined,
	}
}

function mapField(field: string, primaryKey: string): string {
	if (field === 'id' && primaryKey === '_id') return '_id'
	return field
}

function compileWhere(w: WhereOp, primaryKey: string): MongoFilter {
	const field = mapField(w.field, primaryKey)

	switch (w.condition) {
		case Condition.eq:
			return { [field]: { $eq: w.value } }
		case Condition.ne:
			return { [field]: { $ne: w.value } }
		case Condition.gt:
			return { [field]: { $gt: w.value } }
		case Condition.gte:
			return { [field]: { $gte: w.value } }
		case Condition.lt:
			return { [field]: { $lt: w.value } }
		case Condition.lte:
			return { [field]: { $lte: w.value } }
		case Condition.in:
			return { [field]: { $in: w.value } }
		case Condition.nin:
			return { [field]: { $nin: w.value } }
		case Condition.like:
			return { [field]: { $regex: new RegExp(String(w.value), 'i') } }
		case Condition.exists:
			return { [field]: { $exists: w.value } }
		case Condition.contains:
			return { [field]: { $all: Array.isArray(w.value) ? w.value : [w.value] } }
		case Condition.notContains:
			return { [field]: { $not: { $all: Array.isArray(w.value) ? w.value : [w.value] } } }
		default:
			return { [field]: { $eq: w.value } }
	}
}

function compileAnd(a: AndOp, primaryKey: string): MongoFilter | null {
	const clauses = a.clauses.map((c) => compileOp(c, primaryKey)).filter((c): c is MongoFilter => c !== null)

	if (clauses.length === 0) return null
	if (clauses.length === 1) return clauses[0]
	return { $and: clauses }
}

function compileOr(o: OrOp, primaryKey: string): MongoFilter | null {
	const clauses = o.clauses.map((c) => compileOp(c, primaryKey)).filter((c): c is MongoFilter => c !== null)

	if (clauses.length === 0) return null
	if (clauses.length === 1) return clauses[0]
	return { $or: clauses }
}

function compileOp(op: FilterOp, primaryKey: string): MongoFilter | null {
	if (op instanceof WhereOp) return compileWhere(op, primaryKey)
	if (op instanceof AndOp) return compileAnd(op, primaryKey)
	if (op instanceof OrOp) return compileOr(op, primaryKey)
	return null
}

export function compileMongoUpdate(data: Record<string, unknown>, raws: unknown[], now: Date): Record<string, unknown> {
	const $set: Record<string, unknown> = { updatedAt: now.getTime() }
	const $inc: Record<string, unknown> = {}
	const $mul: Record<string, unknown> = {}
	const $min: Record<string, unknown> = {}
	const $max: Record<string, unknown> = {}
	const $unset: Record<string, ''> = {}
	const $push: Record<string, unknown> = {}
	const $pull: Record<string, unknown> = {}

	for (const [key, value] of Object.entries(data)) {
		if (value instanceof IncOp) $inc[key] = value.by
		else if (value instanceof MulOp) $mul[key] = value.by
		else if (value instanceof MinOp) $min[key] = value.value
		else if (value instanceof MaxOp) $max[key] = value.value
		else if (value instanceof UnsetOp) $unset[key] = ''
		else if (value instanceof PushOp) $push[key] = value.value
		else if (value instanceof PullOp) $pull[key] = value.value
		else if (value instanceof PatchOp) $set[`${key}.${value.path.join('.')}`] = value.value
		else $set[key] = value
	}

	const result: Record<string, unknown> = { $set }
	if (Object.keys($inc).length) result.$inc = $inc
	if (Object.keys($mul).length) result.$mul = $mul
	if (Object.keys($min).length) result.$min = $min
	if (Object.keys($max).length) result.$max = $max
	if (Object.keys($unset).length) result.$unset = $unset
	if (Object.keys($push).length) result.$push = $push
	if (Object.keys($pull).length) result.$pull = $pull

	for (const rawOp of raws) {
		if (typeof rawOp === 'object' && rawOp !== null) {
			for (const [key, value] of Object.entries(rawOp as Record<string, unknown>)) {
				if (key === '$set') result.$set = { ...(result.$set as any), ...(value as any) }
				else result[key] = value
			}
		}
	}

	return result
}
