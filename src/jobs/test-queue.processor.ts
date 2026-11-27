import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Job } from 'bullmq';

@Processor('test-queue')
export class TestQueueProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(TestQueueProcessor.name);

  // BullMQ re-emits failures from its own Redis connection onto the worker as an
  // 'error' event. Node treats an unhandled 'error' event as a fatal throw, so a
  // transient Redis blip — including the connection closing during shutdown — would
  // take the whole API process down. Attached on bootstrap rather than module init,
  // because BullRegistrar creates the worker in its own onModuleInit and Nest does not
  // order the two against each other.
  onApplicationBootstrap() {
    this.worker.on('error', (error: Error) => {
      this.logger.warn(`test-queue worker connection warning/error: ${error.message}`);
    });
  }

  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(
      `Processing test background job ${job.id} with data: ${JSON.stringify(job.data)}`,
    );
    return { status: 'completed', jobId: job.id };
  }
}
