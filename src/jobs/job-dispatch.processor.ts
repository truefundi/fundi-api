import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { Job } from 'bullmq';
import { JobsService } from './jobs.service';

interface ExpireOfferTask {
  offerId: string;
}

interface AutoCompleteJobTask {
  jobId: string;
  dueAt: string;
}

@Processor('job-dispatch')
export class JobDispatchProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(JobDispatchProcessor.name);

  constructor(private readonly jobs: JobsService) {
    super();
  }

  onApplicationBootstrap() {
    this.worker.on('error', (error: Error) => {
      this.logger.warn(
        `Job dispatch worker connection warning/error: ${error.message}`,
      );
    });
  }

  async process(
    job: Job<ExpireOfferTask | AutoCompleteJobTask, void, string>,
  ): Promise<void> {
    if (job.name === 'expire-offer') {
      if (!('offerId' in job.data)) {
        throw new Error('Invalid expire-offer task payload.');
      }
      await this.jobs.expireOffer(job.data.offerId);
      return;
    }
    if (job.name === 'auto-complete-job') {
      if (!('jobId' in job.data)) {
        throw new Error('Invalid auto-complete-job task payload.');
      }
      await this.jobs.autoCompleteAfterConfirmation(
        job.data.jobId,
        job.data.dueAt,
      );
      return;
    }
    throw new Error(`Unsupported job-dispatch task: ${job.name}`);
  }
}
