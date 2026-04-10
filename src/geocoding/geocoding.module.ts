import { Module } from '@nestjs/common';
import { GeocodingController } from './geocoding.controller';
import {
  GeocodingService,
  GEOCODING_PROVIDERS_TOKEN,
} from './geocoding.service';
import { ConfigModule } from '@nestjs/config';
import { InternalApiGuard } from '../common/guards/internal-api.guard';
import { MapboxGeocodingProvider } from './providers/mapbox-geocoding.provider';
import { OpenCageGeocodingProvider } from './providers/opencage-geocoding.provider';
import { GeocodingProvider } from './dto/geocoding.dto';

@Module({
  imports: [ConfigModule],
  controllers: [GeocodingController],
  providers: [
    MapboxGeocodingProvider,
    OpenCageGeocodingProvider,
    {
      provide: GEOCODING_PROVIDERS_TOKEN,
      useFactory: (
        mapbox: MapboxGeocodingProvider,
        openCage: OpenCageGeocodingProvider,
      ) => ({
        [GeocodingProvider.MAPBOX]: mapbox,
        [GeocodingProvider.OPENCAGE]: openCage,
      }),
      inject: [MapboxGeocodingProvider, OpenCageGeocodingProvider],
    },
    GeocodingService,
    InternalApiGuard,
  ],
  exports: [GeocodingService],
})
export class GeocodingModule {}
