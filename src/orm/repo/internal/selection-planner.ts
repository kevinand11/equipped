import { EquippedError } from '../../../errors'
import type { AnySchema } from '../../schema'

export type ComputedSelectionPlan = {
	requestedSelect: Set<string> | null
	adapterSelect?: string[]
	computeNames: string[]
}

export function planSelection(schema: AnySchema, select?: readonly string[]): ComputedSelectionPlan {
	const computedDefs = schema.computedDefs as Record<string, { deps: readonly string[] }>
	const computedNames = new Set(Object.keys(computedDefs))
	const persistedNames = new Set(Object.keys(schema.fields))

	if (!select || select.length === 0) {
		return {
			requestedSelect: null,
			adapterSelect: undefined,
			computeNames: [...computedNames],
		}
	}

	const requestedSelect = new Set(select)
	const adapterSelect = new Set<string>()
	const selectedComputeNames = new Set<string>()

	for (const key of select) {
		if (persistedNames.has(key)) {
			adapterSelect.add(key)
			continue
		}
		if (computedNames.has(key)) {
			selectedComputeNames.add(key)
			for (const dep of computedDefs[key].deps) adapterSelect.add(dep)
			continue
		}
		throw new EquippedError('Unknown selected field', {
			schema: schema.name,
			selectedField: key,
			availableFields: [...persistedNames, ...computedNames],
		})
	}

	return {
		requestedSelect,
		adapterSelect: [...adapterSelect],
		computeNames: [...selectedComputeNames],
	}
}
