import { ClassPropertiesWrapper } from 'valleyed'
import { Random } from '../utils/utils'

const deleteKeyFromObject = (obj: Record<string, any>, keys: string[]) => {
	if (obj === undefined || obj === null) return
	if (keys.length === 1) return delete obj[keys[0]]
	const key = keys.pop() ?? ''
	return deleteKeyFromObject(obj[key], keys)
}

export class BaseEntity<Keys extends Record<string, any>> extends ClassPropertiesWrapper<Keys>{
	public hash: string
	public ignoreInJSON: string[] = []
	public __type = this.constructor.name

	constructor (keys: Keys) {
		super(keys)
		this.hash = Random.string()
	}

	toJSON (includeIgnored = false) {
		const json = super.toJSON()
		if (!includeIgnored) this.ignoreInJSON.forEach((k) => deleteKeyFromObject(json, k.split('.').reverse()))
		delete json.ignoreInJSON
		return json
	}

	toString () {
		return JSON.stringify(this.toJSON(true))
	}
}
