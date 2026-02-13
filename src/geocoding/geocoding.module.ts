import { Module } from '@nestjs/common';
import { GeocodingController } from './geocoding.controller';
import { GeocodingService } from './geocoding.service';
import { ConfigModule } from '@nestjs/config';
import { InternalApiGuard } from '../common/guards/internal-api.guard';

@Module({
  imports: [ConfigModule],
  controllers: [GeocodingController],
  providers: [GeocodingService, InternalApiGuard],
  exports: [GeocodingService],
})
export class GeocodingModule {}
