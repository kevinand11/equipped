import { CustomError } from '../../errors'
import { Instance } from '../../instance'
import { makeErrorMiddleware } from '../controllers'
import { StatusCodes } from '../statusCodes'

export const errorHandler = makeErrorMiddleware(
	async (_, err) => {
		const error = err as CustomError
		if (error.isCustomError) {
			return {
				status: error.statusCode,
				result: error.serializedErrors
			}
		} else {
			await Instance.get().logger.error(err)
			return {
				status: StatusCodes.BadRequest,
				result: [{ message: 'Something went wrong', data: err.message }]
			}
		}
	}
)