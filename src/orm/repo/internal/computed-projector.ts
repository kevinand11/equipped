import { v, type Pipe } from 'valleyed'

import type { ComputedSelectionPlan } from './selection-planner'
import { EquippedError } from '../../../errors'
import type { AnySchema } from '../../schema'

type ComputedDef = {
	pipe: Pipe<any, any>
	deps: readonly string[]
	compute: (data: Record<string, unknown>) => unknown
}

export function applyComputedSelection(
	schema: AnySchema,
	rows: Record<string, unknown>[],
	plan: ComputedSelectionPlan,
): Record<string, unknown>[] {
	const computedDefs = schema.computedDefs as Record<string, ComputedDef>

	return rows.map((row) => {
		const enriched: Record<string, unknown> = { ...row }
		for (const computeName of plan.computeNames) {
			const def = computedDefs[computeName]
			const depInput: Record<string, unknown> = {}
			for (const dep of def.deps) {
				if (!(dep in row)) {
					throw new EquippedError('Computed field dependency missing from adapter result', {
						schema: schema.name,
						computedField: computeName,
						dependency: dep,
						dependencies: def.deps,
					})
				}
				depInput[dep] = row[dep]
			}
			enriched[computeName] = v.assert(def.pipe, def.compute(depInput))
		}

		if (!plan.requestedSelect) return enriched

		const shaped: Record<string, unknown> = {}
		for (const key of plan.requestedSelect) {
			if (key in enriched) shaped[key] = enriched[key]
		}
		return shaped
	})
}
