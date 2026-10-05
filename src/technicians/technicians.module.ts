import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { StorageModule } from '../storage/storage.module';
import { TechniciansController } from './technicians.controller';
import { TechniciansAdminController } from './technicians-admin.controller';
import { TechniciansService } from './technicians.service';
import { TechniciansPublicController } from './technicians-public.controller';
import { NationalIdCryptoService } from './national-id-crypto.service';
import { TechnicianDocumentsController } from './documents/technician-documents.controller';
import { TechnicianDocumentsAdminController } from './documents/technician-documents-admin.controller';
import { TechnicianDocumentsService } from './documents/technician-documents.service';

// Groups the technician profile endpoints, document handling, and persistence services.
@Module({
  imports: [DatabaseModule, StorageModule],
  controllers: [
    TechniciansController,
    TechniciansAdminController,
    TechniciansPublicController,
    TechnicianDocumentsController,
    TechnicianDocumentsAdminController,
  ],
  providers: [
    TechniciansService,
    NationalIdCryptoService,
    TechnicianDocumentsService,
  ],
  exports: [TechniciansService],
})
export class TechniciansModule {}
