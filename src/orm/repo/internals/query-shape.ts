import { Instance } from '../../../instance'
import { OrmValidationError, type OrmValidationFailure } from '../../errors'
import { ManyRelation, OneRelation, type AnyPreloadDef, type AnyRelDef, type NestedPreloadDef } from '../../relations'
import type { AnySchema } from '../../schema'

const FALLBACK_PAGINATION_DEFAULT_LIMIT = 100
const MAX_PRELOAD_DEPTH = 5

export type ReadOffsetSource =
	| { kind: 'offset'; value: unknown }
	| { kind: 'page'; value: unknown }

export type ReadLimitSource = { value: unknown }

export type NormalisedAllReadQuery = {
	limit?: number
	offset?: number
}

function isRelDef(def: unknown): def is AnyRelDef {
	return def instanceof ManyRelation || def instanceof OneRelation
}

function isNestedPreloadDef(def: AnyPreloadDef): def is NestedPreloadDef {
	return typeof def === 'object' && def != null && 'def' in def
}

function relationStep(def: AnyRelDef) {
	return `${def.source.name}.${def.name}->${def.target.name}`
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isNonNegativeInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function getPaginationDefaultLimit() {
	return Instance.maybeGet()?.settings.utils.paginationDefaultLimit ?? FALLBACK_PAGINATION_DEFAULT_LIMIT
}

function collectSelectFailures(schema: AnySchema, select: readonly string[] | undefined, failures: OrmValidationFailure[]) {
	if (!select || select.length === 0) return

	const persistedNames = new Set(Object.keys(schema.fields))
	const computedNames = new Set(Object.keys(schema.computedDefs as Record<string, unknown>))
	for (const field of select) {
		if (persistedNames.has(field) || computedNames.has(field)) continue
		failures.push({
			field,
			cause: `Unknown selected field "${field}" on schema "${schema.name}"`,
		})
	}
}

function collectPreloadFailures(
	schema: AnySchema,
	defs: readonly AnyPreloadDef[] | undefined,
	failures: OrmValidationFailure[],
	depth = 1,
	path: readonly string[] = [],
) {
	if (defs == null) return
	if (!Array.isArray(defs)) {
		failures.push({ cause: 'Preloads must be an array' })
		return
	}
	if (defs.length === 0) return

	if (depth > MAX_PRELOAD_DEPTH) {
		failures.push({ cause: `Preload depth exceeded max depth ${MAX_PRELOAD_DEPTH}` })
		return
	}

	for (const preload of defs) {
		const rawDef = isRelDef(preload) ? preload : isNestedPreloadDef(preload) ? preload.def : undefined
		if (!isRelDef(rawDef)) {
			failures.push({ cause: 'Invalid preload definition: expected a relation definition or nested preload definition with `def`' })
			continue
		}

		if (rawDef.source !== schema) {
			failures.push({
				field: rawDef.name,
				cause: `Preload relation "${rawDef.name}" belongs to source schema "${rawDef.source.name}" but was used from schema "${schema.name}"`,
			})
		}

		const step = relationStep(rawDef)
		if (path.includes(step)) {
			failures.push({ field: rawDef.name, cause: `Preload cycle detected: ${[...path, step].join(' -> ')}` })
			continue
		}

		if (isNestedPreloadDef(preload)) {
			const nested = preload.preloads ?? []
			if (!Array.isArray(nested)) {
				failures.push({ field: rawDef.name, cause: `Nested preloads for relation "${rawDef.name}" must be an array` })
				continue
			}
			collectPreloadFailures(rawDef.target, nested, failures, depth + 1, [...path, step])
		}
	}
}

function collectLimitFailure(value: unknown, failures: OrmValidationFailure[]): number | undefined {
	if (isPositiveInteger(value)) return value
	failures.push({ field: 'limit', cause: 'Limit must be a positive safe integer' })
	return undefined
}

function collectOffsetFailure(value: unknown, failures: OrmValidationFailure[]): number | undefined {
	if (isNonNegativeInteger(value)) return value
	failures.push({ field: 'offset', cause: 'Offset must be a non-negative safe integer' })
	return undefined
}

function collectPageFailure(value: unknown, failures: OrmValidationFailure[]): number | undefined {
	if (isPositiveInteger(value)) return value
	failures.push({ field: 'page', cause: 'Page must be a positive safe integer' })
	return undefined
}

function throwIfFailures(schema: AnySchema, operation: string, failures: OrmValidationFailure[]) {
	if (failures.length > 0) throw new OrmValidationError('query-shape', schema.name, operation, failures)
}

export function assertNormalisedFindReadShape(
	schema: AnySchema,
	operation: string,
	state: {
		select: readonly string[] | undefined
		preloads: readonly AnyPreloadDef[] | undefined
	},
): void {
	const failures: OrmValidationFailure[] = []
	collectSelectFailures(schema, state.select, failures)
	collectPreloadFailures(schema, state.preloads, failures)
	throwIfFailures(schema, operation, failures)
}

export function normaliseAllFindReadShape(
	schema: AnySchema,
	operation: string,
	state: {
		select: readonly string[] | undefined
		preloads: readonly AnyPreloadDef[] | undefined
		limitSource?: ReadLimitSource
		offsetSource?: ReadOffsetSource
	},
): NormalisedAllReadQuery {
	const failures: OrmValidationFailure[] = []
	collectSelectFailures(schema, state.select, failures)
	collectPreloadFailures(schema, state.preloads, failures)

	let limit = state.limitSource === undefined ? undefined : collectLimitFailure(state.limitSource.value, failures)
	let offset: number | undefined

	if (state.offsetSource?.kind === 'offset') {
		offset = collectOffsetFailure(state.offsetSource.value, failures)
	} else if (state.offsetSource?.kind === 'page') {
		const page = collectPageFailure(state.offsetSource.value, failures)
		if (limit === undefined && state.limitSource === undefined) {
			limit = getPaginationDefaultLimit()
			if (!isPositiveInteger(limit)) {
				failures.push({ field: 'limit', cause: 'Default page limit must be a positive safe integer' })
				limit = undefined
			}
		}
		if (page !== undefined && limit !== undefined) {
			const resolvedOffset = (page - 1) * limit
			if (isNonNegativeInteger(resolvedOffset)) {
				offset = resolvedOffset
			} else {
				failures.push({ field: 'offset', cause: 'Resolved page offset must be a non-negative safe integer' })
			}
		}
	}

	throwIfFailures(schema, operation, failures)
	return { limit, offset }
}
