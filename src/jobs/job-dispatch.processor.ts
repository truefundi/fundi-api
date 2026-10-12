import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { Job } from 'bullmq';
import { JobsService } from './jobs.service';

interface ExpireOfferTask {
  offerId: string;
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

  async process(job: Job<ExpireOfferTask, void, string>): Promise<void> {
    if (job.name === 'expire-offer') {
      await this.jobs.expireOffer(job.data.offerId);
      return;
    }
    throw new Error(`Unsupported job-dispatch task: ${job.name}`);
  }
}
