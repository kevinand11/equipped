import { RequestError } from '../../errors'
import { Instance } from '../../instance'
import { makeErrorMiddleware, StatusCodes } from '../types'

export const errorHandler = makeErrorMiddleware(async (req, error) => {
	Instance.get().logger.error(error)
	return error instanceof RequestError
		? req.error({
				body: error.serializedErrors,
				status: error.statusCode,
			})
		: req.error({
				body: [<any>{ message: 'Something went wrong', data: error.message }],
				status: StatusCodes.BadRequest,
			})
})
