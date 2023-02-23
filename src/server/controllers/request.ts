import { CustomError } from '../../errors'
import { StorageFile } from '../../storage'
import { AuthUser, RefreshUser } from '../../utils/authUser'
import { parseJSONValue } from '../../utils/json'

type HeaderKeys = 'AccessToken' | 'RefreshToken' | 'Referer' | 'ContentType' | 'UserAgent'

export class Request {
	readonly ip: string
	readonly method: string
	readonly path: string
	readonly body: Record<string, any>
	readonly cookies: Record<string, any>
	readonly rawBody: Record<string, any>
	readonly params: Record<string, string>
	readonly query: Record<string, string>
	readonly headers: Record<HeaderKeys | string, any>
	readonly files: Record<string, StorageFile[]>
	authUser: null | AuthUser = null
	refreshUser: null | RefreshUser = null
	pendingError: null | CustomError = null

	constructor ({
		ip, body, cookies, params, query,
		method, path, headers, files, data
	}: {
		ip: string
		body: Record<string, any>
		cookies: Record<string, any>
		params: Record<string, any>
		query: Record<string, any>
		headers: Record<HeaderKeys, any>
		files: Record<string, StorageFile[]>
		method: string
		path: string,
		data: Record<string, any>
	}) {
		this.ip = ip
		this.method = method
		this.path = path
		this.rawBody = body
		this.body = Object.fromEntries(
			Object.entries(body)
				.map(([key, value]) => [key, parseJSONValue(value)])
		)
		this.cookies = cookies
		this.params = params
		this.query = Object.fromEntries(
			Object.entries(query ?? {})
				.map(([key, val]) => [key, this.#parseQueryStrings(val)])
		)
		this.headers = headers
		this.files = files
		this.authUser = data.authUser ?? null
		this.refreshUser = data.refreshUser ?? null
	}

	#parseQueryStrings (value: string | string[]) {
		if (Array.isArray(value)) return value.map(this.#parseQueryStrings)
		return parseJSONValue(value)
	}
}
