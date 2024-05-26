import { OpenAPIV3_1 } from 'openapi-types'
import { Instance } from '../instance'

export const generateSwaggerDocument = (): OpenAPIV3_1.Document => {
	const settings = Instance.get().settings
	return {
		openapi: '3.0.0',
		info: { title: settings.appId, version: settings.swaggerDocsVersion },
		components: {
			securitySchemes: {
				AccessToken: {
					type: 'apiKey',
					name: 'Access-Token',
					in: 'header',
				},
				RefreshToken: {
					type: 'apiKey',
					name: 'Refresh-Token',
					in: 'header',
				}
			},
		}
	}
}