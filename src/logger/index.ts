import chalk from 'chalk'

export abstract class Logger {
	abstract success (...args: any[]): Promise<void>

	abstract info (...args: any[]): Promise<void>

	abstract warn (...args: any[]): Promise<void>

	abstract error (...args: any[]): Promise<void>
}

export class ConsoleLogger extends Logger {
	// eslint-disable-next-line no-console
	#log = console.log

	#getTime () {
		const date = new Date().toJSON()
		const split = date.split('T')
		return [split[0], split[1].slice(0, 8)].join('T')
	}

	async error (...args: any[]) {
		this.#log(chalk.red(`[ERROR] ${this.#getTime()}`, ...args))
	}

	async success (...args: any[]) {
		this.#log(chalk.greenBright(`[SUCCESS] ${this.#getTime()}`, ...args))
	}

	async info (...args: any[]) {
		this.#log(chalk.blueBright(`[INFO] ${this.#getTime()}`, ...args))
	}

	async warn (...args: any[]) {
		this.#log(chalk.yellow(	`[WARNING] ${this.#getTime()}`, ...args))
	}
}