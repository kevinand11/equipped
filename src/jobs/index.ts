import Bull from 'bull'

import { RedisCache } from '../cache/types/redis-cache'
import { RedisJobConfig } from '../schemas'
import { CronLikeJobs, CronTypes, DelayedJobs } from '../types/overrides'
import { Random } from '../utils/utils'

enum JobNames {
	CronJob = 'CronJob',
	CronLikeJob = 'CronLikeJob',
	DelayedJob = 'DelayedJob',
}

type Cron = CronTypes[keyof CronTypes]
type DelayedJobEvent = DelayedJobs[keyof DelayedJobs]
type CronLikeJobEvent = CronLikeJobs[keyof CronLikeJobs]
type DelayedJobCallback = (data: DelayedJobEvent) => Promise<void> | void
type CronCallback = (name: CronTypes[keyof CronTypes]) => Promise<void> | void
type CronLikeCallback = (data: CronLikeJobEvent) => Promise<void> | void

export class RedisJob {
	#queue: Bull.Queue

	constructor(config: RedisJobConfig) {
		this.#queue = new Bull(config.queueName, {
			createClient: (type) =>
				new RedisCache(
					config.config,
					type === 'client'
						? undefined
						: {
								maxRetriesPerRequest: null,
								enableReadyCheck: false,
							},
				).client as any,
		})
	}

	static #getNewId() {
		return [Date.now(), Random.string()].join(':')
	}

	async addDelayedJob(data: DelayedJobEvent, delayInMs: number): Promise<string> {
		const job = await this.#queue.add(JobNames.DelayedJob, data, {
			jobId: RedisJob.#getNewId(),
			delay: delayInMs,
			removeOnComplete: true,
			backoff: 1000,
			attempts: 3,
		})
		return job.id.toString()
	}

	async addCronLikeJob(data: CronLikeJobEvent, cron: string, tz?: string): Promise<string> {
		const job = await this.#queue.add(JobNames.CronLikeJob, data, {
			jobId: RedisJob.#getNewId(),
			repeat: { cron, ...(tz ? { tz } : {}) },
			removeOnComplete: true,
			backoff: 1000,
			attempts: 3,
		})
		return (job.opts?.repeat as any)?.key ?? ''
	}

	async removeDelayedJob(jobId: string) {
		const job = await this.#queue.getJob(jobId)
		if (job) await job.discard()
	}

	async removeCronLikeJob(jobKey: string) {
		await this.#queue.removeRepeatableByKey(jobKey)
	}

	async retryAllFailedJobs() {
		const failedJobs = await this.#queue.getFailed()
		await Promise.all(failedJobs.map((job) => job.retry()))
	}

	async startProcessingQueues(
		crons: { name: Cron; cron: string }[],
		callbacks: { onDelayed?: DelayedJobCallback; onCron?: CronCallback; onCronLike?: CronLikeCallback },
	) {
		await this.#cleanup()
		await Promise.all(crons.map(({ cron, name }) => this.#addCronJob(name, cron)))
		Promise.all([
			this.#queue.process(JobNames.DelayedJob, async (job) => await (callbacks.onDelayed as any)?.(job.data)),
			this.#queue.process(JobNames.CronJob, async (job) => await (callbacks.onCron as any)?.(job.data.type)),
			this.#queue.process(JobNames.CronLikeJob, async (job) => await (callbacks.onCronLike as any)?.(job.data)),
		])
	}

	async #addCronJob(type: Cron | string, cron: string): Promise<string> {
		const job = await this.#queue.add(
			JobNames.CronJob,
			{ type },
			{
				repeat: { cron },
				removeOnComplete: true,
				backoff: 1000,
				attempts: 3,
			},
		)
		return job.id.toString()
	}

	async #cleanup() {
		await this.retryAllFailedJobs()
		const repeatableJobs = await this.#queue.getRepeatableJobs()
		await Promise.all(
			repeatableJobs.filter((job) => job.name === JobNames.CronJob).map((job) => this.#queue.removeRepeatableByKey(job.key)),
		)
	}
}
