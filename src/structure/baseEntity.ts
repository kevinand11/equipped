import { ClassPropertiesWrapper } from 'valleyed'

import { Random, clone } from '../utils/utils'

const deleteKeyFromObject = (obj: Record<string, any>, keys: string[]) => {
	if (obj === undefined || obj === null) return
	const isArray = Array.isArray(obj)
	if (keys.length === 1 && !isArray) return delete obj[keys[0]]
	if (isArray) return obj.map((v) => deleteKeyFromObject(v, keys))
	return deleteKeyFromObject(obj[keys[0]], keys.slice(1))
}

export class BaseEntity<Keys extends object = object, Ignored extends string = never> extends ClassPropertiesWrapper<Keys> {
	public __hash: string = Random.string()
	public __type = this.constructor.name
	public readonly __ignoreInJSON: Ignored[] = []

	toJSON(includeIgnored = false) {
		const json: Record<string, any> = {}
		Object.keys(this)
			.concat(Object.getOwnPropertyNames(Object.getPrototypeOf(this)))
			.forEach((key) => {
				const value = this[key]
				if (typeof value === 'function') return
				json[key] = value?.toJSON?.(includeIgnored) ?? clone(value)
			})
		if (includeIgnored !== true)
			this.__ignoreInJSON.concat('__ignoreInJSON' as any).forEach((k: string) => deleteKeyFromObject(json, k.split('.')))
		return json
	}

	toString(includeIgnored = true) {
		return JSON.stringify(this.toJSON(includeIgnored), null, 2)
	}
}
