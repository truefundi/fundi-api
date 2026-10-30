import { Module } from '@nestjs/common';
import { GeocodingService } from '../jobs/geocoding.service';

@Module({
  providers: [GeocodingService],
  exports: [GeocodingService],
})
export class GeocodingModule {}
