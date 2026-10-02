import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { TechniciansController } from './technicians.controller';
import { TechniciansAdminController } from './technicians-admin.controller';
import { TechniciansService } from './technicians.service';
import { TechniciansPublicController } from './technicians-public.controller';
import { NationalIdCryptoService } from './national-id-crypto.service';

// Groups the technician profile endpoints and persistence service.
@Module({
  imports: [DatabaseModule],
  controllers: [
    TechniciansController,
    TechniciansAdminController,
    TechniciansPublicController,
  ],
  providers: [TechniciansService, NationalIdCryptoService],
  exports: [TechniciansService],
})
export class TechniciansModule {}
