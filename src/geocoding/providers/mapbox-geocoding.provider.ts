import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
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

@Injectable()
export class MapboxGeocodingProvider implements IGeocodingProvider {
  private readonly logger = new Logger(MapboxGeocodingProvider.name);
  private readonly client: GeocodeService;

  constructor(private readonly configService: ConfigService) {
    const accessToken = this.configService.get<string>('MAPBOX_API_KEY');

    if (!accessToken) {
      this.logger.error('MAPBOX_API_KEY is not configured');
      throw new InternalServerErrorException(
        'Geocoding service is not properly configured',
      );
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
        const result: ForwardGeocodeResponseDto = {
          type: 'coordinates',
          address:
            feature?.[`place_name_${locale}`] ?? feature?.place_name ?? '',
          coordinates: feature?.center as [number, number],
          place_type: feature?.place_type,
          bbox: feature?.bbox,
        };

        if (feature?.context) {
          for (const item of feature.context) {
            const text = item?.[`text_${locale}`] ?? item?.text;

            if (item?.id?.startsWith('postcode')) result.postcode = text;
            else if (item?.id?.startsWith('place')) result.place = text;
            else if (item?.id?.startsWith('district')) result.district = text;
            else if (item?.id?.startsWith('region')) result.region = text;
            else if (item?.id?.startsWith('country')) result.country = text;
          }
        }

        results.push(result);
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
        results.push({
          type: 'coordinates',
          address:
            feature?.[`place_name_${locale}`] ?? feature?.place_name ?? '',
          coordinates: feature?.center as [number, number],
          place_type: feature?.place_type,
          bbox: feature?.bbox,
        });
      }

      if (response.body.features[0]?.context && results[0]) {
        for (const item of response.body.features[0].context) {
          const text = item?.[`text_${locale}`] ?? item?.text;

          if (item?.id?.startsWith('postcode')) results[0].postcode = text;
          else if (item?.id?.startsWith('place')) results[0].place = text;
          else if (item?.id?.startsWith('district')) results[0].district = text;
          else if (item?.id?.startsWith('region')) results[0].region = text;
          else if (item?.id?.startsWith('country')) results[0].country = text;
        }
      }
    }

    return results;
  }
}
