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
  GeocodingProvider,
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
    private readonly providers: Record<GeocodingProvider, IGeocodingProvider>,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  private getProvider(
    module: GeocodingProvider = GeocodingProvider.MAPBOX,
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
    const providerKey = query.provider ?? GeocodingProvider.MAPBOX;
    const cacheKey = `geocode:forward:${providerKey}:${address}:${locale}:${limit}`;

    const cachedResult =
      await this.cacheManager.get<ForwardGeocodeResponseDto[]>(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    try {
      const results = await this.getProvider(query.provider).forwardGeocode(
        query,
      );
      await this.cacheManager.set(cacheKey, results, this.cacheTTL);
      return results;
    } catch (error) {
      this.logger.error(
        `Forward geocoding failed for address: ${address}`,
        error,
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
    const { coordinates, locale = 'en', provider } = query;
    const providerKey = provider ?? GeocodingProvider.MAPBOX;
    const [lng, lat] = coordinates;
    // Round to 5 decimal places (~1.1m precision) to maximise cache hits
    // for coordinates that differ only due to GPS jitter or floating-point noise
    const roundedLng = parseFloat(lng.toFixed(5));
    const roundedLat = parseFloat(lat.toFixed(5));

    // Generate cache key
    const cacheKey = `geocode:reverse:${providerKey}:${roundedLng},${roundedLat}:${locale}`;

    // Try to get from cache
    const cachedResult =
      await this.cacheManager.get<ReverseGeocodeResponseDto[]>(cacheKey);
    if (cachedResult) {
      this.logger.debug(
        `Cache hit for reverse geocode: ${roundedLng},${roundedLat}`,
      );
      console.log('Cache hit:', cachedResult);
      return cachedResult;
    }

    this.logger.debug(
      `Cache miss for reverse geocode: ${roundedLng},${roundedLat}`,
    );

    try {
      const results = await this.getProvider(provider).reverseGeocode({
        coordinates: [roundedLng, roundedLat],
        locale,
      });
      await this.cacheManager.set(cacheKey, results, this.cacheTTL);
      return results;
    } catch (error) {
      this.logger.error(
        `Reverse geocoding failed for coordinates: ${lng},${lat}`,
        error,
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
