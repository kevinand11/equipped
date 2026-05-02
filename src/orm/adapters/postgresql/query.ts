import type { FilterOp, QueryOptions } from '../../query'
import { QueryGroup, Where, WhereGroupOp, WhereOp } from '../../query'
import { IncOp, MaxOp, MinOp, MulOp, PatchOp, PullOp, PushOp, UnsetOp } from '../../updates'

function mapField(field: string, primaryKey: string): string {
	if (field === 'id' && primaryKey !== 'id') return primaryKey
	return field
}

function compilePgFilter(group: any, primaryKey: string): { whereClause: string; params: unknown[]; nextParamIndex: number } {
	const clauses: FilterOp[] = group.children
	const params: unknown[] = []
	let paramIndex = 1

	function nextParam(value: unknown): string {
		params.push(value)
		return `$${paramIndex++}`
	}

	const whereParts: string[] = []

	for (const clause of clauses) {
		const compiled = compileOp(clause, primaryKey, nextParam)
		if (compiled) whereParts.push(compiled)
	}

	const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : ''
	return { whereClause, params, nextParamIndex: paramIndex }
}

function compileWhere(w: Where, primaryKey: string, nextParam: (v: unknown) => string): string {
	const field = `"${mapField(w.field, primaryKey)}"`

	switch (w.op) {
		case WhereOp.eq:
			return w.value === null ? `${field} IS NULL` : `${field} = ${nextParam(w.value)}`
		case WhereOp.ne:
			return w.value === null ? `${field} IS NOT NULL` : `${field} != ${nextParam(w.value)}`
		case WhereOp.gt:
			return `${field} > ${nextParam(w.value)}`
		case WhereOp.gte:
			return `${field} >= ${nextParam(w.value)}`
		case WhereOp.lt:
			return `${field} < ${nextParam(w.value)}`
		case WhereOp.lte:
			return `${field} <= ${nextParam(w.value)}`
		case WhereOp.in:
			return `${field} = ANY(${nextParam(w.value)})`
		case WhereOp.nin:
			return `NOT (${field} = ANY(${nextParam(w.value)}))`
		case WhereOp.like:
			return `${field} ILIKE ${nextParam(`%${w.value}%`)}`
		case WhereOp.exists:
			return w.value ? `${field} IS NOT NULL` : `${field} IS NULL`
		case WhereOp.contains:
			return `${field} @> ${nextParam(JSON.stringify(w.value))}::jsonb`
		case WhereOp.ncontains:
			return `NOT (${field} @> ${nextParam(JSON.stringify(w.value))}::jsonb)`
		default:
			return `${field} = ${nextParam(w.value)}`
	}
}

function compileAnd(group: any, primaryKey: string, nextParam: (v: unknown) => string): string | null {
	const parts = group.children.map((c) => compileOp(c, primaryKey, nextParam)).filter((c): c is string => c !== null)
	if (parts.length === 0) return null
	if (parts.length === 1) return parts[0]
	return `(${parts.join(' AND ')})`
}

function compileOr(group: any, primaryKey: string, nextParam: (v: unknown) => string): string | null {
	const parts = group.children.map((c) => compileOp(c, primaryKey, nextParam)).filter((c): c is string => c !== null)
	if (parts.length === 0) return null
	if (parts.length === 1) return parts[0]
	return `(${parts.join(' OR ')})`
}

function compileOp(op: FilterOp, primaryKey: string, nextParam: (v: unknown) => string): string | null {
	if (op instanceof Where) return compileWhere(op, primaryKey, nextParam)
	if (op instanceof QueryGroup) {
		if (op.op === WhereGroupOp.and) return compileAnd(op, primaryKey, nextParam)
		if (op.op === WhereGroupOp.or) return compileOr(op, primaryKey, nextParam)
	}
	return null
}

export function buildSelectQuery(
	group: any,
	options: QueryOptions | undefined,
	tableName: string,
	primaryKey: string,
): { sql: string; params: unknown[] } {
	const { whereClause, params, nextParamIndex } = compilePgFilter(group, primaryKey)
	let i = nextParamIndex

	const orderParts = (options?.orderBy ?? []).map((o) => `"${mapField(o.field, primaryKey)}" ${o.direction.toUpperCase()}`)
	const orderClause = orderParts.length > 0 ? `ORDER BY ${orderParts.join(', ')}` : ''

	let limitClause = ''
	if (options?.limit != null) {
		params.push(options.limit)
		limitClause = `LIMIT $${i++}`
	}
	let offsetClause = ''
	if (options?.offset != null) {
		params.push(options.offset)
		offsetClause = `OFFSET $${i++}`
	}
	const selectClause = options?.select?.length ? options.select.map((f) => `"${mapField(f, primaryKey)}"`).join(', ') : '*'

	const sql = `SELECT ${selectClause} FROM "${tableName}" ${whereClause} ${orderClause} ${limitClause} ${offsetClause}`
		.trim()
		.replace(/\s+/g, ' ')
	return { sql, params }
}

export function buildCountQuery(group: any, tableName: string, primaryKey: string): { sql: string; params: unknown[] } {
	const { whereClause, params } = compilePgFilter(group, primaryKey)
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
	group: any,
	tableName: string,
	primaryKey: string,
	data: Record<string, unknown>,
): { sql: string; params: unknown[] } {
	const params: unknown[] = []
	let paramIndex = 1

	const setParts = Object.entries(data).map(([key, value]) => {
		const col = `"${key}"`

		if (value instanceof IncOp) {
			params.push(value.by)
			return `${col} = ${col} + $${paramIndex++}`
		}
		if (value instanceof MulOp) {
			params.push(value.by)
			return `${col} = ${col} * $${paramIndex++}`
		}
		if (value instanceof MinOp) {
			params.push(value.value)
			return `${col} = LEAST(${col}, $${paramIndex++})`
		}
		if (value instanceof MaxOp) {
			params.push(value.value)
			return `${col} = GREATEST(${col}, $${paramIndex++})`
		}
		if (value instanceof UnsetOp) {
			return `${col} = NULL`
		}
		if (value instanceof PushOp) {
			params.push(JSON.stringify(value.value))
			return `${col} = ${col} || jsonb_build_array($${paramIndex++}::jsonb)`
		}
		if (value instanceof PullOp) {
			params.push(JSON.stringify(value.value))
			return `${col} = (SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) FROM jsonb_array_elements(${col}) e WHERE e <> $${paramIndex++}::jsonb)`
		}
		if (value instanceof PatchOp) {
			params.push(JSON.stringify(value.value))
			const path = `'{${value.path.join(',')}}'`
			return `${col} = jsonb_set(${col}, ${path}::text[], $${paramIndex++}::jsonb)`
		}

		params.push(value)
		return `${col} = $${paramIndex++}`
	})

	const { whereClause, params: whereParams } = compilePgFilter(group, primaryKey)
	const adjustedWhere = whereClause.replace(/\$(\d+)/g, () => `$${paramIndex++}`)
	params.push(...whereParams)

	const sql = `UPDATE "${tableName}" SET ${setParts.join(', ')} ${adjustedWhere} RETURNING *`.trim().replace(/\s+/g, ' ')
	return { sql, params }
}

export function buildDeleteQuery(group: any, tableName: string, primaryKey: string): { sql: string; params: unknown[] } {
	const { whereClause, params } = compilePgFilter(group, primaryKey)
	const sql = `DELETE FROM "${tableName}" ${whereClause} RETURNING *`.trim().replace(/\s+/g, ' ')
	return { sql, params }
}
