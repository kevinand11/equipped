import { Condition, type AndOp, type OrOp, type QueryAST, type WhereOp } from '../../query/types'

export function compilePgQuery(
	ast: QueryAST,
	_tableName: string,
	primaryKey: string,
): {
	whereClause: string
	orderClause: string
	limitClause: string
	offsetClause: string
	selectClause: string
	params: unknown[]
} {
	const params: unknown[] = []
	let paramIndex = 1

	function nextParam(value: unknown): string {
		params.push(value)
		return `$${paramIndex++}`
	}

	const whereParts: string[] = []

	for (const w of ast.wheres) {
		whereParts.push(compileWhere(w, primaryKey, nextParam))
	}

	for (const a of ast.ands) {
		const compiled = compileAnd(a, primaryKey, nextParam)
		if (compiled) whereParts.push(compiled)
	}

	for (const o of ast.ors) {
		const compiled = compileOr(o, primaryKey, nextParam)
		if (compiled) whereParts.push(compiled)
	}

	const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : ''

	const orderParts = ast.orderBys.map((o) => {
		const field = mapField(o.field, primaryKey)
		return `"${field}" ${o.direction.toUpperCase()}`
	})
	const orderClause = orderParts.length > 0 ? `ORDER BY ${orderParts.join(', ')}` : ''

	const limitClause = ast.limit !== null ? `LIMIT ${nextParam(ast.limit)}` : ''
	const offsetClause = ast.offset !== null ? `OFFSET ${nextParam(ast.offset)}` : ''

	const selectClause = ast.selects.length > 0 ? ast.selects.map((f) => `"${mapField(f, primaryKey)}"`).join(', ') : '*'

	return { whereClause, orderClause, limitClause, offsetClause, selectClause, params }
}

function mapField(field: string, primaryKey: string): string {
	if (field === 'id' && primaryKey !== 'id') return primaryKey
	return field
}

function compileWhere(w: WhereOp, primaryKey: string, nextParam: (v: unknown) => string): string {
	const field = `"${mapField(w.field, primaryKey)}"`

	switch (w.condition) {
		case Condition.eq:
			return w.value === null ? `${field} IS NULL` : `${field} = ${nextParam(w.value)}`
		case Condition.ne:
			return w.value === null ? `${field} IS NOT NULL` : `${field} != ${nextParam(w.value)}`
		case Condition.gt:
			return `${field} > ${nextParam(w.value)}`
		case Condition.gte:
			return `${field} >= ${nextParam(w.value)}`
		case Condition.lt:
			return `${field} < ${nextParam(w.value)}`
		case Condition.lte:
			return `${field} <= ${nextParam(w.value)}`
		case Condition.in:
			return `${field} = ANY(${nextParam(w.value)})`
		case Condition.nin:
			return `NOT (${field} = ANY(${nextParam(w.value)}))`
		case Condition.like:
			return `${field} ILIKE ${nextParam(`%${w.value}%`)}`
		case Condition.exists:
			return w.value ? `${field} IS NOT NULL` : `${field} IS NULL`
		case Condition.contains:
			return `${field} @> ${nextParam(JSON.stringify(w.value))}::jsonb`
		case Condition.notContains:
			return `NOT (${field} @> ${nextParam(JSON.stringify(w.value))}::jsonb)`
		default:
			return `${field} = ${nextParam(w.value)}`
	}
}

function compileAnd(a: AndOp, primaryKey: string, nextParam: (v: unknown) => string): string | null {
	const parts = a.clauses.map((c) => compileOp(c, primaryKey, nextParam)).filter((c): c is string => c !== null)

	if (parts.length === 0) return null
	if (parts.length === 1) return parts[0]
	return `(${parts.join(' AND ')})`
}

function compileOr(o: OrOp, primaryKey: string, nextParam: (v: unknown) => string): string | null {
	const parts = o.clauses.map((c) => compileOp(c, primaryKey, nextParam)).filter((c): c is string => c !== null)

	if (parts.length === 0) return null
	if (parts.length === 1) return parts[0]
	return `(${parts.join(' OR ')})`
}

function compileOp(op: AndOp['clauses'][number], primaryKey: string, nextParam: (v: unknown) => string): string | null {
	switch (op.kind) {
		case 'where':
			return compileWhere(op, primaryKey, nextParam)
		case 'and':
			return compileAnd(op, primaryKey, nextParam)
		case 'or':
			return compileOr(op, primaryKey, nextParam)
		default:
			return null
	}
}

export function buildSelectQuery(ast: QueryAST, tableName: string, primaryKey: string): { sql: string; params: unknown[] } {
	const { whereClause, orderClause, limitClause, offsetClause, selectClause, params } = compilePgQuery(ast, tableName, primaryKey)
	const sql = `SELECT ${selectClause} FROM "${tableName}" ${whereClause} ${orderClause} ${limitClause} ${offsetClause}`
		.trim()
		.replace(/\s+/g, ' ')
	return { sql, params }
}

export function buildCountQuery(ast: QueryAST, tableName: string, primaryKey: string): { sql: string; params: unknown[] } {
	const { whereClause, params } = compilePgQuery(ast, tableName, primaryKey)
	const sql = `SELECT COUNT(*) as count FROM "${tableName}" ${whereClause}`.trim().replace(/\s+/g, ' ')
	return { sql, params }
}

export function buildInsertQuery(tableName: string, data: Record<string, unknown>): { sql: string; params: unknown[] } {
	const keys = Object.keys(data)
	const params = Object.values(data)
	const placeholders = keys.map((_, i) => `$${i + 1}`)
	const columns = keys.map((k) => `"${k}"`).join(', ')
	const sql = `INSERT INTO "${tableName}" (${columns}) VALUES (${placeholders.join(', ')}) RETURNING *`
	return { sql, params }
}

export function buildUpdateQuery(
	ast: QueryAST,
	tableName: string,
	primaryKey: string,
	data: Record<string, unknown>,
): { sql: string; params: unknown[] } {
	const params: unknown[] = []
	let paramIndex = 1

	const setParts = Object.entries(data).map(([key, value]) => {
		params.push(value)
		return `"${key}" = $${paramIndex++}`
	})

	const { whereClause, params: whereParams } = (() => {
		const result = compilePgQuery(ast, tableName, primaryKey)
		const adjusted = result.whereClause.replace(/\$(\d+)/g, () => `$${paramIndex++}`)
		return { whereClause: adjusted, params: result.params }
	})()

	params.push(...whereParams)

	const sql = `UPDATE "${tableName}" SET ${setParts.join(', ')} ${whereClause} RETURNING *`.trim().replace(/\s+/g, ' ')
	return { sql, params }
}

export function buildDeleteQuery(ast: QueryAST, tableName: string, primaryKey: string): { sql: string; params: unknown[] } {
	const { whereClause, params } = compilePgQuery(ast, tableName, primaryKey)
	const sql = `DELETE FROM "${tableName}" ${whereClause} RETURNING *`.trim().replace(/\s+/g, ' ')
	return { sql, params }
}
