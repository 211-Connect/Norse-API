import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import mbxGeocoding from '@mapbox/mapbox-sdk/services/geocoding';
import { GeocodeService } from '@mapbox/mapbox-sdk/services/geocoding';
import { IGeocodingProvider } from './geocoding-provider.interface';
import {
  ForwardGeocodeQueryDto,
  ForwardGeocodeResponseDto,
  ReverseGeocodeQueryDto,
  ReverseGeocodeResponseDto,
} from '../dto/geocoding.dto';
import { mapMapboxFeatureToGeocodeResponse } from '../mappers/geocoding.mapper';

@Injectable()
export class MapboxGeocodingProvider implements IGeocodingProvider {
  private readonly logger = new Logger(MapboxGeocodingProvider.name);
  private readonly client: GeocodeService;

  constructor(private readonly configService: ConfigService) {
    const accessToken = this.configService.get<string>('MAPBOX_API_KEY');

    if (!accessToken) {
      this.logger.error('MAPBOX_API_KEY is not configured');
    }
    this.client = mbxGeocoding({ accessToken });
  }

  async forwardGeocode(
    query: ForwardGeocodeQueryDto,
  ): Promise<ForwardGeocodeResponseDto[]> {
    const { address, locale = 'en', limit = 5 } = query;

    const response = await this.client
      .forwardGeocode({
        query: address,
        countries: ['US'],
        autocomplete: true,
        language: [locale],
        limit,
      })
      .send();

    const results: ForwardGeocodeResponseDto[] = [];

    if (response.body?.features) {
      for (const feature of response.body.features) {
        results.push(mapMapboxFeatureToGeocodeResponse(feature, locale));
      }
    }

    return results;
  }

  async reverseGeocode(
    query: ReverseGeocodeQueryDto,
  ): Promise<ReverseGeocodeResponseDto[]> {
    const { coordinates, locale = 'en' } = query;
    const [lng, lat] = coordinates;

    const response = await this.client
      .reverseGeocode({
        query: [lng, lat],
        types: ['address'],
        countries: ['US'],
        language: [locale],
        limit: 1,
      })
      .send();

    const results: ReverseGeocodeResponseDto[] = [];

    if (response.body?.features && response.body.features.length > 0) {
      for (const feature of response.body.features) {
        results.push(mapMapboxFeatureToGeocodeResponse(feature, locale));
      }
    }

    return results;
  }
}
