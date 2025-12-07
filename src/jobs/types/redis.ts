import { Queue, Worker } from 'bullmq'

import { RedisCache } from '../../cache/types/redis'
import { Instance } from '../../instance'
import { CronTypes, DelayedJobs, RepeatableJobs } from '../../types'
import { Random } from '../../utilities'
import { RedisJobConfig } from '../pipes'

enum JobNames {
	CronJob = 'CronJob',
	RepeatableJob = 'RepeatableJob',
	DelayedJob = 'DelayedJob',
}

type Cron = CronTypes[keyof CronTypes]
type DelayedJobEvent = DelayedJobs[keyof DelayedJobs]
type RepeatableJobEvent = RepeatableJobs[keyof RepeatableJobs]
type DelayedJobCallback = (data: DelayedJobEvent) => Promise<void> | void
type CronJobCallback = (name: CronTypes[keyof CronTypes]) => Promise<void> | void
type RepeatableJobCallback = (data: RepeatableJobEvent) => Promise<void> | void

type JobCallbacks = { onDelayed?: DelayedJobCallback; onCron?: CronJobCallback; onRepeatable?: RepeatableJobCallback }

export class RedisJob {
	#queue: Queue
	#callbacks: JobCallbacks = {}
	#crons: { name: Cron; cron: string }[] = []

	constructor(config: RedisJobConfig) {
		const redisCache = new RedisCache(config.redisConfig, {
			maxRetriesPerRequest: null,
			enableReadyCheck: false,
		})
		this.#queue = new Queue(config.queueName, { connection: redisCache.client.options, skipVersionCheck: true })
		const worker = new Worker(
			config.queueName,
			async (job) => {
				switch (job.name) {
					case JobNames.DelayedJob:
						return (this.#callbacks.onDelayed as any)?.(job.data)
					case JobNames.CronJob:
						return (this.#callbacks.onCron as any)?.(job.data.type)
					case JobNames.RepeatableJob:
						return (this.#callbacks.onRepeatable as any)?.(job.data)
				}
			},
			{ connection: redisCache.client.options, autorun: false, skipVersionCheck: true },
		)

		Instance.on(
			'start',
			async () => {
				await this.#cleanup()
				await Promise.all(this.#crons.map(({ cron, name }) => this.#addCron(name, cron)))
				worker.run()
			},
			10,
		)
	}

	set callbacks(callbacks: JobCallbacks) {
		this.#callbacks = callbacks
	}

	set crons(crons: { name: Cron; cron: string }[]) {
		this.#crons = crons
	}

	static #getNewId() {
		return [Date.now(), Random.string()].join(':')
	}

	async addDelayed(data: DelayedJobEvent, delayInMs: number): Promise<string> {
		const job = await this.#queue.add(JobNames.DelayedJob, data, {
			jobId: RedisJob.#getNewId(),
			delay: delayInMs,
			removeOnComplete: true,
			backoff: 1000,
			attempts: 3,
		})
		return job.id!.toString()
	}

	async addRepeatable(data: RepeatableJobEvent, cron: string, tz?: string): Promise<string> {
		const job = await this.#queue.add(JobNames.RepeatableJob, data, {
			jobId: RedisJob.#getNewId(),
			repeat: { pattern: cron, ...(tz ? { tz } : {}) },
			removeOnComplete: true,
			backoff: 1000,
			attempts: 3,
		})
		return job.opts?.repeat?.key ?? ''
	}

	async removeDelayed(jobId: string) {
		const job = await this.#queue.getJob(jobId)
		if (job) await job.remove()
	}

	async retryAllFailedJobs() {
		const failedJobs = await this.#queue.getFailed()
		await Promise.all(failedJobs.map((job) => job.retry()))
	}

	async #addCron(type: Cron | string, cron: string): Promise<string> {
		const job = await this.#queue.add(
			JobNames.CronJob,
			{ type },
			{
				jobId: RedisJob.#getNewId(),
				repeat: { pattern: cron },
				removeOnComplete: true,
				backoff: 1000,
				attempts: 3,
			},
		)
		return job.id!.toString()
	}

	async #cleanup() {
		await this.retryAllFailedJobs()
		const repeatableJobs = await this.#queue.getJobSchedulers()
		await Promise.all(repeatableJobs.map((job) => this.#queue.removeJobScheduler(job.key)))
	}
}
