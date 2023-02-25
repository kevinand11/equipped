import { Instance } from '../instance'
import { Controller, makeController } from './controllers'
import { errorHandler } from './middlewares/errorHandler'
import { notFoundHandler } from './middlewares/notFoundHandler'
import { StatusCodes } from './statusCodes'

type MethodTypes = 'get' | 'post' | 'put' | 'delete' | 'all'

export type Route = {
	path: string
	method: MethodTypes
	controllers: Controller[]
}

export const PostRoutes = (): Route[] => [
	{
		path: '__health',
		method: 'get',
		controllers: [
			makeController(async () => {
				return {
					status: StatusCodes.Ok,
					result: `${Instance.get().settings.appId} service running`
				}
			})
		]
	},
	{
		path: '',
		method: 'all',
		controllers: [notFoundHandler]
	},
	{
		path: '',
		method: 'all',
		controllers: [errorHandler]
	}
]

export const groupRoutes = (parent: string, routes: Route[]): Route[] => routes
	.map((route) => ({ ...route, path: `${parent}/${route.path}` }))
