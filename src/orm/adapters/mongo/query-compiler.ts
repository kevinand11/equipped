import { Condition, type AndOp, type OrOp, type QueryAST, type WhereOp } from '../../query/types'

type MongoFilter = Record<string, unknown>

export function compileMongoQuery(
	ast: QueryAST,
	primaryKey: string,
): {
	filter: MongoFilter
	sort: Record<string, 1 | -1> | undefined
	limit: number | undefined
	skip: number | undefined
	projection: Record<string, 1> | undefined
} {
	const clauses: MongoFilter[] = []

	for (const w of ast.wheres) {
		clauses.push(compileWhere(w, primaryKey))
	}

	for (const a of ast.ands) {
		const compiled = compileAnd(a, primaryKey)
		if (compiled) clauses.push(compiled)
	}

	for (const o of ast.ors) {
		const compiled = compileOr(o, primaryKey)
		if (compiled) clauses.push(compiled)
	}

	let filter: MongoFilter = {}
	if (clauses.length === 1) {
		filter = clauses[0]
	} else if (clauses.length > 1) {
		filter = { $and: clauses }
	}

	const sort =
		ast.orderBys.length > 0
			? Object.fromEntries(ast.orderBys.map((o) => [mapField(o.field, primaryKey), o.direction === 'desc' ? -1 : 1]))
			: undefined

	const projection = ast.selects.length > 0 ? Object.fromEntries(ast.selects.map((f) => [mapField(f, primaryKey), 1])) : undefined

	return {
		filter,
		sort: sort as Record<string, 1 | -1> | undefined,
		limit: ast.limit ?? undefined,
		skip: ast.offset ?? undefined,
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

function compileOp(op: AndOp['clauses'][number], primaryKey: string): MongoFilter | null {
	switch (op.kind) {
		case 'where':
			return compileWhere(op, primaryKey)
		case 'and':
			return compileAnd(op, primaryKey)
		case 'or':
			return compileOr(op, primaryKey)
		default:
			return null
	}
}

export function compileMongoUpdate(data: Record<string, unknown>, raws: unknown[], now: Date): Record<string, unknown> {
	const result: Record<string, unknown> = {}

	if (Object.keys(data).length > 0) {
		result.$set = { ...data, updatedAt: now.getTime() }
	}

	for (const rawOp of raws) {
		if (typeof rawOp === 'object' && rawOp !== null) {
			for (const [key, value] of Object.entries(rawOp as Record<string, unknown>)) {
				if (key === '$set') {
					result.$set = { ...(result.$set as any), ...(value as any) }
				} else {
					result[key] = value
				}
			}
		}
	}

	if (Object.keys(result).length > 0 && !result.$set) {
		result.$set = { updatedAt: now.getTime() }
	}

	return result
}
