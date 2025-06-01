import { RequestError } from '../../errors'
import { Instance } from '../../instance'
import { makeErrorMiddleware, StatusCodes } from '../types'

export const errorHandler = makeErrorMiddleware(async (req, error) => {
	if (error instanceof RequestError)
		return req.error({
			body: error.serializedErrors,
			status: error.statusCode,
		})
	else {
		Instance.get().logger.error(error)
		return req.error({
			body: [<any>{ message: 'Something went wrong', data: error.message }],
			status: StatusCodes.BadRequest,
		})
	}
})
