import { AsyncLocalStorage } from 'node:async_hooks'

import { Pipe, PipeError, PipeInput, PipeOutput, v } from 'valleyed'

import { Instance } from '../instance'
import type { IncomingFile, Response, Request, RouteDef, RouteDefToReqRes } from '../server'

export * from 'valleyed/lib/api/externals'

const filePipe = (err?: string) =>
	v.array(
		v.file<IncomingFile>(err).pipe((input) => {
			const err = `is larger than allowed limit of ${Instance.get().settings.server?.requests.maxFileUploadSizeInMb}mb`
			const valid = input ? !input.isTruncated : true
			if (valid) return input
			throw PipeError.root(err, input)
		}),
	)

export const incomingFile = (err?: string) =>
	v.pipe<unknown, IncomingFile, any>(
		(input) =>
			filePipe(err)
				.pipe(v.min(1, 'no file provided'))
				.pipe((files) => files[0])
				.parse(input),
		{ schema: () => ({ type: 'string', format: 'binary' }) },
	)

export const incomingFiles = (err?: string) =>
	v.pipe<unknown, IncomingFile[], any>((input) => filePipe(err).parse(input), { schema: () => ({ type: 'string', format: 'binary' }) })

export const requestLocalStorage = new AsyncLocalStorage<Request<RouteDefToReqRes<RouteDef>>>()
export const responseLocalStorage = new AsyncLocalStorage<Response<RouteDefToReqRes<RouteDef>>>()

export const withRequest = <T extends Pipe<any, any, any>>(fn: (req: Request<RouteDefToReqRes<RouteDef>>) => T) =>
	v.pipe<PipeInput<T>, PipeOutput<T>, any>((input) => {
		const req = requestLocalStorage.getStore()
		if (!req) throw PipeError.root('Request not found in context', input)
		return fn(req).parse(input)
	})

export const withResponse = <T extends Pipe<any, any, any>>(fn: (req: Response<RouteDefToReqRes<RouteDef>>) => T) =>
	v.pipe<PipeInput<T>, PipeOutput<T>, any>((input) => {
		const res = responseLocalStorage.getStore()
		if (!res) throw PipeError.root('Response not found in context', input)
		return fn(res).parse(input)
	})
