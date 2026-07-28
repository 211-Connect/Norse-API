import { GeocodeResponseDto } from '../dto/geocoding.dto';

/**
 * Maps a raw Mapbox geocoding `feature` into the shared `GeocodeResponseDto`
 * schema used across all geocoding providers.
 */
export function mapMapboxFeatureToGeocodeResponse(
  feature: any,
  locale: string,
): GeocodeResponseDto {
  const result: GeocodeResponseDto = {
    type: 'coordinates',
    address: feature?.[`place_name_${locale}`] ?? feature?.place_name ?? '',
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

  return result;
}

/**
 * Maps a raw OpenCage geocoding `result` into the shared `GeocodeResponseDto`
 * schema used across all geocoding providers.
 */
export function mapOpenCageResultToGeocodeResponse(
  result: any,
): GeocodeResponseDto {
  const components = result?.components ?? {};
  const bounds = result?.bounds;

  return {
    type: 'coordinates',
    address: result.formatted,
    coordinates: [result.geometry.lng, result.geometry.lat] as [number, number],
    postcode: components.postcode,
    place: components.city || components.town || components.village,
    district:
      components.suburb || components.neighbourhood || components.county,
    region: components.state,
    country: components.country,
    place_type: components._type ? [components._type] : undefined,
    bbox: bounds
      ? [
          bounds.southwest.lng,
          bounds.southwest.lat,
          bounds.northeast.lng,
          bounds.northeast.lat,
        ]
      : undefined,
  };
}
