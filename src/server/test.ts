import { v } from 'valleyed'

import { Router } from './routes'

const router = new Router({
	path: '/test',
	schema: {
		query: v.object({
			a: v.string(),
		}),
		// defaultStatusCode: 400,
	},
})

router.get('/', {
	schema: {
		query: v.object({
			b: v.number(),
		}),
		defaultStatusCode: 200,
	},
})((_req) => '')
