import { CustomError } from '../../errors'
import { Instance } from '../../instance'
import { Response } from '../request'
import { makeErrorMiddleware } from '../routes'
import { StatusCodes } from '../statusCodes'

export const errorHandler = makeErrorMiddleware(
	async (_, err) => {
		const error = err as CustomError
		if (error.isCustomError) return new Response({
			body: error.serializedErrors,
			status: error.statusCode
		})
		else {
			await Instance.get().logger.error(err)
			return new Response({
				body: [{ message: 'Something went wrong', data: err.message }],
				status: StatusCodes.BadRequest
			})
		}
	}
)