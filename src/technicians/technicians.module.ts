import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TechniciansController } from './technicians.controller';
import { TechniciansAdminController } from './technicians-admin.controller';
import { TechniciansService } from './technicians.service';
import { TechniciansPublicController } from './technicians-public.controller';
import { TechnicianDocumentsController } from './documents/technician-documents.controller';
import { TechnicianDocumentsAdminController } from './documents/technician-documents-admin.controller';
import { TechnicianDocumentsService } from './documents/technician-documents.service';
import { NationalIdCryptoService } from './national-id-crypto.service';
import {
  TechnicianServicesAdminController,
  TechnicianServicesController,
} from './services/technician-services.controller';
import { TechnicianServicesService } from './services/technician-services.service';

// Groups the technician profile endpoints, document handling, and persistence services.
@Module({
  imports: [DatabaseModule, StorageModule, NotificationsModule, AuthModule],
  controllers: [
    TechniciansController,
    TechniciansAdminController,
    TechniciansPublicController,
    TechnicianDocumentsController,
    TechnicianDocumentsAdminController,
    TechnicianServicesController,
    TechnicianServicesAdminController,
  ],
  providers: [
    TechniciansService,
    TechnicianDocumentsService,
    NationalIdCryptoService,
    TechnicianServicesService,
  ],
  exports: [TechniciansService],
})
export class TechniciansModule {}
