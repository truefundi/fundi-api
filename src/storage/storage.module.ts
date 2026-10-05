import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';

// Provides private file storage (S3-compatible bucket or local disk) to feature modules.
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
