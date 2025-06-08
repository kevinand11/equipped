export const parseJSONValue = (data: any) => {
	try {
		if (data?.constructor?.name !== 'String') return data
		return JSON.parse(data)
	} catch {
		return data
	}
}

export function parseJSONObject<T extends object>(data: T) {
	return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, parseJSONValue(value)])) as T
}
