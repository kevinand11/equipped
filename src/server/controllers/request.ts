import { Request as ExpressRequest } from 'express'
import { CustomError } from '../../errors'
import { StorageFile } from '../../storage'
import { AuthUser, RefreshUser } from '../../utils/authUser'
import { parseJSONValue } from '../../utils/json'
import { getMediaDuration } from '../../utils/media'

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
	readonly headers: Record<HeaderKeys | string, string | null>
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
		headers: Record<HeaderKeys | string, string | null>
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

	static async make (req: ExpressRequest): Promise<Request> {
		const allHeaders = Object.fromEntries(Object.entries(req.headers).map(([key, val]) => [key, val ?? null]))
		const headers = {
			...allHeaders,
			AccessToken: req.get('Access-Token') ?? null,
			RefreshToken: req.get('Refresh-Token') ?? null,
			ContentType: req.get('Content-Type') ?? null,
			Referer: req.get('referer') ?? null,
			UserAgent: req.get('User-Agent') ?? null
		}
		// @ts-ignore
		const files = Object.fromEntries(await Promise.all(Object.entries(req.files ?? {}).map(async ([key, file]) => {
			const fileArray: StorageFile[] = []
			if (file) await Promise.all((Array.isArray(file) ? file : [file]).map(async (f) => fileArray.push({
				name: f.name,
				type: f.mimetype,
				size: f.size,
				isTruncated: f.truncated,
				data: f.data,
				duration: await getMediaDuration(f.data)
			})))
			return [key, fileArray]
		})))

		// @ts-ignore
		return req.savedReq ||= new Request({
			ip: req.ip,
			body: req.body ?? {},
			cookies: req.cookies ?? {},
			params: req.params ?? {},
			query: req.query ?? {},
			method: req.method,
			path: req.path,
			headers, files,
			data: {}
		})
	}
}
