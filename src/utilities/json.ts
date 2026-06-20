export const parseJSONValue = (data: any) => {
	try {
		if (data?.constructor?.name !== 'String') return data
		return JSON.parse(data)
	} catch {
		return data
	}
}
