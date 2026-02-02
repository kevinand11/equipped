import type { AuthUser } from '../../types'
import { BaseRequestAuthMethod } from '../requests-auth-methods'
import { makeMiddleware } from '../types'

export const requireAuthUser = (methods: BaseRequestAuthMethod<AuthUser>[]) =>
	makeMiddleware(
		async (request) => {
			request.authUser = await BaseRequestAuthMethod.process(methods, request.headers)
		},
		(route) => {
			route.security ??= []
			route.security.push({ Authorization: [] }, { ApiKey: [] })
			route.descriptions ??= []
			route.descriptions.push('Requires a valid means of authentication.')
		},
	)
