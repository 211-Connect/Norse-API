import {
  ForwardGeocodeQueryDto,
  ForwardGeocodeResponseDto,
  ReverseGeocodeQueryDto,
  ReverseGeocodeResponseDto,
} from '../dto/geocoding.dto';

export interface IGeocodingProvider {
  forwardGeocode(
    query: ForwardGeocodeQueryDto,
  ): Promise<ForwardGeocodeResponseDto[]>;

  reverseGeocode(
    query: ReverseGeocodeQueryDto,
  ): Promise<ReverseGeocodeResponseDto[]>;
}
