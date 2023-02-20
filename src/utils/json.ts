
export const parseJSONValue = (data: any) => {
	try {
		return JSON.parse(data)
	} catch {
		return data
	}
}