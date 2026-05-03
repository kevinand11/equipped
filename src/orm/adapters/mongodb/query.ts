import type { FilterOp, QueryOptions } from '../../query'
import { QueryGroup, Where, WhereGroupOp, WhereOp } from '../../query'
import { IncOp, MaxOp, MinOp, MulOp, PatchOp, PullOp, PushOp, UnsetOp } from '../../updates'

type MongoFilter = Record<string, unknown>

export function compileMongoQuery(
	group: QueryGroup,
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
	for (const clause of group.children) {
		const compiled = compileOp(clause, primaryKey)
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

function compileWhere(w: Where, primaryKey: string): MongoFilter {
	const field = mapField(w.field, primaryKey)

	switch (w.op) {
		case WhereOp.eq:
			return { [field]: { $eq: w.value } }
		case WhereOp.ne:
			return { [field]: { $ne: w.value } }
		case WhereOp.gt:
			return { [field]: { $gt: w.value } }
		case WhereOp.gte:
			return { [field]: { $gte: w.value } }
		case WhereOp.lt:
			return { [field]: { $lt: w.value } }
		case WhereOp.lte:
			return { [field]: { $lte: w.value } }
		case WhereOp.in:
			return { [field]: { $in: w.value } }
		case WhereOp.nin:
			return { [field]: { $nin: w.value } }
		case WhereOp.like:
			return { [field]: { $regex: new RegExp(String(w.value), 'i') } }
		case WhereOp.exists:
			return { [field]: { $exists: w.value } }
		case WhereOp.contains:
			return { [field]: { $all: Array.isArray(w.value) ? w.value : [w.value] } }
		case WhereOp.ncontains:
			return { [field]: { $not: { $all: Array.isArray(w.value) ? w.value : [w.value] } } }
		default:
			return { [field]: { $eq: w.value } }
	}
}

function compileAnd(group: QueryGroup, primaryKey: string): MongoFilter | null {
	const clauses = group.children.map((c) => compileOp(c, primaryKey)).filter((c): c is MongoFilter => c !== null)

	if (clauses.length === 0) return null
	if (clauses.length === 1) return clauses[0]
	return { $and: clauses }
}

function compileOr(group: QueryGroup, primaryKey: string): MongoFilter | null {
	const clauses = group.children.map((c) => compileOp(c, primaryKey)).filter((c): c is MongoFilter => c !== null)

	if (clauses.length === 0) return null
	if (clauses.length === 1) return clauses[0]
	return { $or: clauses }
}

function compileOp(op: FilterOp, primaryKey: string): MongoFilter | null {
	if (op instanceof Where) return compileWhere(op, primaryKey)
	if (op instanceof QueryGroup) {
		if (op.op === WhereGroupOp.and) return compileAnd(op, primaryKey)
		if (op.op === WhereGroupOp.or) return compileOr(op, primaryKey)
	}
	return null
}

export function compileMongoUpdate(data: Record<string, unknown>, now: Date): Record<string, unknown> {
	const $set: Record<string, unknown> = { updatedAt: now.getTime() }
	const $inc: Record<string, unknown> = {}
	const $mul: Record<string, unknown> = {}
	const $min: Record<string, unknown> = {}
	const $max: Record<string, unknown> = {}
	const $unset: Record<string, ''> = {}
	const $push: Record<string, unknown> = {}
	const $pull: Record<string, unknown> = {}

	for (const [key, value] of Object.entries(data)) {
		if (value instanceof IncOp) $inc[key] = value.value
		else if (value instanceof MulOp) $mul[key] = value.value
		else if (value instanceof MinOp) $min[key] = value.value
		else if (value instanceof MaxOp) $max[key] = value.value
		else if (value instanceof UnsetOp) $unset[key] = ''
		else if (value instanceof PushOp) $push[key] = value.value
		else if (value instanceof PullOp) $pull[key] = value.value
		else if (value instanceof PatchOp) {
			const patchVal = value.value as Record<string, unknown>
			for (const [subKey, subVal] of Object.entries(patchVal)) {
				$set[`${key}.${subKey}`] = subVal
			}
		}
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

	return result
}
