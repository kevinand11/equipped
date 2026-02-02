import { NotAuthenticatedError } from '../../errors'
import type { AuthUser } from '../../types'
import { BaseRequestAuthMethod } from '../requests-auth-methods'
import { makeMiddleware } from '../types'

export const requireAuthUser = (methods: BaseRequestAuthMethod<AuthUser>[]) =>
	makeMiddleware(
		async (request) => {
			request.authUser = await BaseRequestAuthMethod.process(methods, request.headers)
			if (!request.authUser) throw new NotAuthenticatedError()
		},
		(route) => {
			route.security ??= []
			for (const method of methods) {
				const schemeName = method.routeSecuritySchemeName()
				if (schemeName) route.security.push({ [schemeName]: [] })
			}

			route.descriptions ??= []
			route.descriptions.push('Requires a valid means of authentication.')
		},
	)
