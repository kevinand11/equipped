export abstract class BaseUseCase<Input, Output> {
	abstract execute (params: Input): Promise<Output>
}