import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

@Processor('test-queue')
export class TestQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(TestQueueProcessor.name);

  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`Processing test background job ${job.id} with data: ${JSON.stringify(job.data)}`);
    return { status: 'completed', jobId: job.id };
  }
}
