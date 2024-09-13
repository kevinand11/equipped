import { CustomError } from '../../errors'
import { Instance } from '../../instance'
import { Response } from '../requests'
import { makeErrorMiddleware, StatusCodes } from '../types'

export const errorHandler = makeErrorMiddleware(
	async (_, error) => {
		if (error instanceof CustomError) return new Response({
			body: error.serializedErrors,
			status: error.statusCode,
			headers: {},
		})
		else {
			await Instance.get().logger.error(error)
			return new Response({
				body: [{ message: 'Something went wrong', data: error.message }],
				status: StatusCodes.BadRequest,
				headers: {},
			})
		}
	}
)