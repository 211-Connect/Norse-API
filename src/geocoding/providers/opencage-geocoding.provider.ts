import { Injectable, Logger } from '@nestjs/common';
import {
  ForwardGeocodeQueryDto,
  ForwardGeocodeResponseDto,
  ReverseGeocodeQueryDto,
  ReverseGeocodeResponseDto,
} from '../dto/geocoding.dto';
import opencage from 'opencage-api-client';
import { IGeocodingProvider } from './geocoding-provider.interface';
import { ConfigService } from '@nestjs/config';
import { mapOpenCageResultToGeocodeResponse } from '../mappers/geocoding.mapper';

@Injectable()
export class OpenCageGeocodingProvider implements IGeocodingProvider {
  private readonly logger = new Logger(OpenCageGeocodingProvider.name);
  private readonly accessToken: string;
  constructor(private readonly configService: ConfigService) {
    this.accessToken = this.configService.get<string>('OPENCAGE_API_KEY');

    if (!this.accessToken) {
      this.logger.error('OPENCAGE_API_KEY is not configured');
    }
  }

  async forwardGeocode(
    query: ForwardGeocodeQueryDto,
  ): Promise<ForwardGeocodeResponseDto[]> {
    const { address, locale = 'en', limit = 5 } = query;
    const response = await opencage.geocode({
      key: this.accessToken,
      q: address,
      language: locale,
      limit,
    });
    return response.results.map(mapOpenCageResultToGeocodeResponse);
  }

  async reverseGeocode(
    query: ReverseGeocodeQueryDto,
  ): Promise<ReverseGeocodeResponseDto[]> {
    const { coordinates, locale = 'en' } = query;
    const lng = coordinates[0];
    const lat = coordinates[1];

    const response = await opencage.geocode({
      key: this.accessToken,
      q: `${lat},${lng}`,
      // countrycode: 'us',
      language: locale,
    });
    return response.results.map(mapOpenCageResultToGeocodeResponse);
  }
}
