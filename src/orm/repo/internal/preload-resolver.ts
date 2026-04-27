import type { OrmUse } from '../../adapters/base'
import type { AnyPreloadDef } from '../../relations'
import type { AnySchema } from '../../schema'
import { resolvePreloads } from '../preloads'

export function resolveRowsPreloads(
	rows: Record<string, unknown>[],
	preloads: readonly AnyPreloadDef[],
	getUse: (schema: AnySchema) => OrmUse,
) {
	return resolvePreloads(rows, preloads, getUse)
}
