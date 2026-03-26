import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  Logger,
  Inject,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import {
  ForwardGeocodeQueryDto,
  ForwardGeocodeResponseDto,
  GeocodingModule,
  ReverseGeocodeQueryDto,
  ReverseGeocodeResponseDto,
} from './dto/geocoding.dto';
import { IGeocodingProvider } from './providers/geocoding-provider.interface';

export const GEOCODING_PROVIDERS_TOKEN = 'GEOCODING_PROVIDERS';

@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);
  private readonly cacheTTL = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

  constructor(
    @Inject(GEOCODING_PROVIDERS_TOKEN)
    private readonly providers: Record<GeocodingModule, IGeocodingProvider>,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  private getProvider(
    module: GeocodingModule = GeocodingModule.MAPBOX,
  ): IGeocodingProvider {
    const provider = this.providers[module];
    if (!provider) {
      throw new BadRequestException(`Unknown geocoding module: ${module}`);
    }
    return provider;
  }

  /**
   * Forward geocode - convert address to coordinates
   */
  async forwardGeocode(
    query: ForwardGeocodeQueryDto,
  ): Promise<ForwardGeocodeResponseDto[]> {
    const { address, locale = 'en', limit = 5 } = query;
    const providerKey = query.module ?? GeocodingModule.MAPBOX;
    const cacheKey = `geocode:forward:${providerKey}:${address}:${locale}:${limit}`;

    const cachedResult =
      await this.cacheManager.get<ForwardGeocodeResponseDto[]>(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    try {
      const results = await this.getProvider(query.module).forwardGeocode(
        query,
      );
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
    const { coordinates, locale = 'en', module } = query;
    const providerKey = module ?? GeocodingModule.MAPBOX;
    const [lng, lat] = coordinates;

    // Generate cache key
    const cacheKey = `geocode:reverse:${providerKey}:${lng},${lat}:${locale}`;

    // Try to get from cache
    const cachedResult =
      await this.cacheManager.get<ReverseGeocodeResponseDto[]>(cacheKey);
    if (cachedResult) {
      this.logger.debug(`Cache hit for reverse geocode: ${lng},${lat}`);
      console.log('Cache hist:', cachedResult);
      return cachedResult;
    }

    this.logger.debug(`Cache miss for reverse geocode: ${lng},${lat}`);

    try {
      const results = await this.getProvider(module).reverseGeocode(query);
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

  /**
   * Clear all geocoding cache
   */
  async clearCache(): Promise<{ cleared: boolean; message: string }> {
    try {
      const store = this.cacheManager.store;

      if (!store) {
        throw new InternalServerErrorException('Cache store not available');
      }

      const keys = await store.keys('geocode:*');
      const totalKeys = keys.length;

      if (totalKeys > 0) {
        // Process keys in batches to avoid memory issues with large datasets
        const batchSize = 1000;
        for (let i = 0; i < totalKeys; i += batchSize) {
          const batch = keys.slice(i, i + batchSize);
          await store.mdel(...batch);
        }
      }

      this.logger.log(
        `Geocoding cache cleared successfully. Deleted ${totalKeys} keys.`,
      );

      return {
        cleared: true,
        message: `Geocoding cache cleared successfully. Deleted ${totalKeys} keys.`,
      };
    } catch (error) {
      this.logger.error('Failed to clear geocoding cache', error.stack);
      throw new InternalServerErrorException('Failed to clear cache');
    }
  }
}
