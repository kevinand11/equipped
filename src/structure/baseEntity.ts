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
	public __type = this.constructor.name

	constructor () {
		this.hash = Random.string()
	}

	toJSON () {
		const json = Object.assign({}, this) as this
		const proto = Object.getPrototypeOf(this)
		Object.getOwnPropertyNames(proto)
			.filter((k) => k !== 'constructor')
			.forEach((key) => {
				const value = this[key as keyof BaseEntity]
				// @ts-ignore
				json[key] = value?.toJSON?.() ?? value
			})
		this.ignoreInJSON.forEach((k) => deleteKeyFromObject(json, k.split('.').reverse()))
		// @ts-ignore
		delete json.ignoreInJSON
		return json
	}
}