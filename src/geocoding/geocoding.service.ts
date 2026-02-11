import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  Logger,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import mbxGeocoding from '@mapbox/mapbox-sdk/services/geocoding';
import { GeoccodingService } from '@mapbox/mapbox-sdk/services/geocoding';
import {
  ForwardGeocodeQueryDto,
  ForwardGeocodeResponseDto,
} from './dto/forward-geocode.dto';
import {
  ReverseGeocodeQueryDto,
  ReverseGeocodeResponseDto,
} from './dto/reverse-geocode.dto';

@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);
  private readonly geocodingClient: GeoccodingService;
  private readonly cacheTTL = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

  constructor(
    private readonly configService: ConfigService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {
    const mapboxApiKey = this.configService.get<string>('MAPBOX_API_KEY');

    if (!mapboxApiKey) {
      this.logger.error('MAPBOX_API_KEY is not configured');
      throw new InternalServerErrorException(
        'Geocoding service is not properly configured',
      );
    }

    this.geocodingClient = mbxGeocoding({ accessToken: mapboxApiKey });
  }

  /**
   * Forward geocode - convert address to coordinates
   */
  async forwardGeocode(
    query: ForwardGeocodeQueryDto,
  ): Promise<ForwardGeocodeResponseDto[]> {
    const { address, locale = 'en', limit = 5 } = query;

    // Generate cache key
    const cacheKey = `geocode:forward:${address}:${locale}:${limit}`;

    // Try to get from cache
    const cachedResult =
      await this.cacheManager.get<ForwardGeocodeResponseDto[]>(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    try {
      const response = await this.geocodingClient
        .forwardGeocode({
          query: address,
          countries: ['US'],
          autocomplete: true,
          language: [locale],
          limit: limit,
        })
        .send();

      // Transform response to match frontend expectations
      const results: ForwardGeocodeResponseDto[] = [];

      if (response.body?.features) {
        for (const feature of response.body.features) {
          const result: ForwardGeocodeResponseDto = {
            type: 'coordinates',
            address:
              feature?.[`place_name_${locale}`] ?? feature?.place_name ?? '',
            coordinates: feature?.center as [number, number],
          };

          // Add detailed location information from context
          if (feature?.context) {
            for (const item of feature.context) {
              const text = item?.[`text_${locale}`] ?? item?.text;

              if (item?.id?.startsWith('postcode')) {
                result.postcode = text;
              } else if (item?.id?.startsWith('place')) {
                result.place = text;
              } else if (item?.id?.startsWith('district')) {
                result.district = text;
              } else if (item?.id?.startsWith('region')) {
                result.region = text;
              } else if (item?.id?.startsWith('country')) {
                result.country = text;
              }
            }
          }

          results.push(result);
        }
      }

      // Cache the results
      await this.cacheManager.set(cacheKey, results, this.cacheTTL);

      return results;
    } catch (error) {
      this.logger.error(
        `Forward geocoding failed for address: ${address}`,
        error.stack,
      );

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to geocode address. Please try again later.',
      );
    }
  }

  /**
   * Reverse geocode - convert coordinates to address
   */
  async reverseGeocode(
    query: ReverseGeocodeQueryDto,
  ): Promise<ReverseGeocodeResponseDto[]> {
    const { coordinates, locale = 'en' } = query;
    const [lng, lat] = coordinates;

    // Generate cache key
    const cacheKey = `geocode:reverse:${lng},${lat}:${locale}`;

    // Try to get from cache
    const cachedResult =
      await this.cacheManager.get<ReverseGeocodeResponseDto[]>(cacheKey);
    if (cachedResult) {
      this.logger.debug(`Cache hit for reverse geocode: ${lng},${lat}`);
      return cachedResult;
    }

    this.logger.debug(`Cache miss for reverse geocode: ${lng},${lat}`);

    try {
      const response = await this.geocodingClient
        .reverseGeocode({
          query: [lng, lat],
          types: ['address'],
          countries: ['US'],
          language: [locale],
          limit: 1,
        })
        .send();

      // Transform response
      const results: ReverseGeocodeResponseDto[] = [];

      if (response.body?.features && response.body.features.length > 0) {
        for (const feature of response.body.features) {
          results.push({
            address:
              feature?.[`place_name_${locale}`] ?? feature?.place_name ?? '',
            coordinates: feature?.center as [number, number],
          });
        }

        // Add detailed location information from the first result's context
        if (response.body.features[0]?.context && results[0]) {
          for (const item of response.body.features[0].context) {
            const text = item?.[`text_${locale}`] ?? item?.text;

            if (item?.id?.startsWith('postcode')) {
              results[0].postcode = text;
            } else if (item?.id?.startsWith('place')) {
              results[0].place = text;
            } else if (item?.id?.startsWith('district')) {
              results[0].district = text;
            } else if (item?.id?.startsWith('region')) {
              results[0].region = text;
            } else if (item?.id?.startsWith('country')) {
              results[0].country = text;
            }
          }
        }
      }

      // Cache the results
      await this.cacheManager.set(cacheKey, results, this.cacheTTL);

      return results;
    } catch (error) {
      this.logger.error(
        `Reverse geocoding failed for coordinates: ${lng},${lat}`,
        error.stack,
      );

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to reverse geocode coordinates. Please try again later.',
      );
    }
  }
}
