import { Random } from '../utils/utils'

const deleteKeyFromObject = (obj: Record<string, any>, keys: string[]) => {
	if (obj === undefined || obj === null) return
	if (keys.length === 1) return delete obj[keys[0]]
	const key = keys.pop() ?? ''
	return deleteKeyFromObject(obj[key], keys)
}

export class BaseEntity {
	public hash: string
	public ignoreInJSON = [] as string[]

	constructor () {
		this.hash = Random.string()
	}

	toJSON () {
		const json = Object.assign({}, this) as Record<string, any>
		this.ignoreInJSON.forEach((k) => deleteKeyFromObject(json, k.split('.').reverse()))
		delete json.ignoreInJSON
		return json
	}
}