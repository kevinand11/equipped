
export const parseJSONValue = (data: any) => {
	if (data.constructor.name !== 'String') return data
	try {
		return JSON.parse(data)
	} catch {
		return data
	}
}