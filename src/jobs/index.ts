import Bull from 'bull'

import { RedisCache } from '../cache/types/redis-cache'
import { Instance } from '../instance'
import { RedisJobConfig } from '../schemas'
import { CronTypes, DelayedJobs, RepeatableJobs } from '../types/overrides'
import { Random } from '../utils/utils'

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
	#queue: Bull.Queue
	#callbacks: JobCallbacks = {}
	#crons: { name: Cron; cron: string }[] = []

	constructor(config: RedisJobConfig) {
		const redisCache = new RedisCache(config.config, {
			maxRetriesPerRequest: null,
			enableReadyCheck: false,
		})
		this.#queue = new Bull(config.queueName, { createClient: () => redisCache.client as any })

		Instance.addHook(
			'pre:start',
			async () => {
				await this.#cleanup()
				await Promise.all(this.#crons.map(({ cron, name }) => this.#addCron(name, cron)))
				Promise.all([
					this.#queue.process(JobNames.DelayedJob, async (job) => await (this.#callbacks.onDelayed as any)?.(job.data)),
					this.#queue.process(JobNames.CronJob, async (job) => await (this.#callbacks.onCron as any)?.(job.data.type)),
					this.#queue.process(JobNames.RepeatableJob, async (job) => await (this.#callbacks.onRepeatable as any)?.(job.data)),
				])
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
		return job.id.toString()
	}

	async addRepeatable(data: RepeatableJobEvent, cron: string, tz?: string): Promise<string> {
		const job = await this.#queue.add(JobNames.RepeatableJob, data, {
			jobId: RedisJob.#getNewId(),
			repeat: { cron, ...(tz ? { tz } : {}) },
			removeOnComplete: true,
			backoff: 1000,
			attempts: 3,
		})
		return job.opts?.repeat?.key ?? ''
	}

	async removeDelayed(jobId: string) {
		const job = await this.#queue.getJob(jobId)
		if (job) await job.discard()
	}

	async removeRepeatable(jobKey: string) {
		await this.#queue.removeRepeatableByKey(jobKey)
	}

	async #addCron(type: Cron | string, cron: string): Promise<string> {
		const job = await this.#queue.add(
			JobNames.CronJob,
			{ type },
			{
				jobId: RedisJob.#getNewId(),
				repeat: { cron },
				removeOnComplete: true,
				backoff: 1000,
				attempts: 3,
			},
		)
		return job.id.toString()
	}

	async #cleanup() {
		const failedJobs = await this.#queue.getFailed()
		await Promise.all(failedJobs.map((job) => job.retry()))
		const repeatableJobs = await this.#queue.getRepeatableJobs()
		await Promise.all(
			repeatableJobs.filter((job) => job.name === JobNames.CronJob).map((job) => this.#queue.removeRepeatableByKey(job.key)),
		)
	}
}
