import {
  mapMapboxFeatureToGeocodeResponse,
  mapOpenCageResultToGeocodeResponse,
} from './geocoding.mapper';

describe('geocoding.mapper', () => {
  describe('mapMapboxFeatureToGeocodeResponse', () => {
    it('maps a full Mapbox feature into GeocodeResponseDto', () => {
      const feature = {
        place_name_en:
          '615 4th Avenue, Seattle, Washington 98104, United States',
        place_name: '615 4th Avenue, Seattle, Washington 98104, United States',
        center: [-122.33047, 47.60329],
        place_type: ['address'],
        bbox: [-122.331, 47.603, -122.33, 47.604],
        context: [
          { id: 'postcode.123', text_en: '98104', text: '98104' },
          { id: 'place.456', text_en: 'Seattle', text: 'Seattle' },
          { id: 'district.789', text_en: 'King County', text: 'King County' },
          { id: 'region.101', text_en: 'Washington', text: 'Washington' },
          {
            id: 'country.112',
            text_en: 'United States',
            text: 'United States',
          },
        ],
      };

      const result = mapMapboxFeatureToGeocodeResponse(feature, 'en');

      expect(result).toEqual({
        type: 'coordinates',
        address: '615 4th Avenue, Seattle, Washington 98104, United States',
        coordinates: [-122.33047, 47.60329],
        place_type: ['address'],
        bbox: [-122.331, 47.603, -122.33, 47.604],
        postcode: '98104',
        place: 'Seattle',
        district: 'King County',
        region: 'Washington',
        country: 'United States',
      });
    });

    it('handles a feature with no context', () => {
      const feature = {
        place_name: '123 Main St',
        center: [-74.006, 40.7128],
        place_type: ['address'],
      };

      const result = mapMapboxFeatureToGeocodeResponse(feature, 'en');

      expect(result).toEqual({
        type: 'coordinates',
        address: '123 Main St',
        coordinates: [-74.006, 40.7128],
        place_type: ['address'],
        bbox: undefined,
      });
    });

    it('falls back to an empty address when place_name is missing', () => {
      const feature = { center: [0, 0] };

      const result = mapMapboxFeatureToGeocodeResponse(feature, 'en');

      expect(result.address).toBe('');
    });
  });

  describe('mapOpenCageResultToGeocodeResponse', () => {
    it('maps a full OpenCage result into GeocodeResponseDto', () => {
      const result = {
        formatted:
          '399 James Street, Seattle, WA 98104, United States of America',
        geometry: { lat: 47.603096, lng: -122.33039 },
        bounds: {
          northeast: { lat: 47.603146, lng: -122.33034 },
          southwest: { lat: 47.603046, lng: -122.33044 },
        },
        components: {
          _type: 'building',
          postcode: '98104',
          city: 'Seattle',
          suburb: 'First Hill',
          state: 'Washington',
          country: 'United States of America',
        },
      };

      const mapped = mapOpenCageResultToGeocodeResponse(result);

      expect(mapped).toEqual({
        type: 'coordinates',
        address:
          '399 James Street, Seattle, WA 98104, United States of America',
        coordinates: [-122.33039, 47.603096],
        postcode: '98104',
        place: 'Seattle',
        district: 'First Hill',
        region: 'Washington',
        country: 'United States of America',
        place_type: ['building'],
        bbox: [-122.33044, 47.603046, -122.33034, 47.603146],
      });
    });

    it('falls back through place/district alternatives', () => {
      const result = {
        formatted: 'Some Village',
        geometry: { lat: 1, lng: 2 },
        components: {
          village: 'Small Village',
          county: 'Some County',
        },
      };

      const mapped = mapOpenCageResultToGeocodeResponse(result);

      expect(mapped.place).toBe('Small Village');
      expect(mapped.district).toBe('Some County');
    });

    it('handles missing components and bounds gracefully', () => {
      const result = {
        formatted: 'Unknown place',
        geometry: { lat: 1, lng: 2 },
      };

      const mapped = mapOpenCageResultToGeocodeResponse(result);

      expect(mapped).toEqual({
        type: 'coordinates',
        address: 'Unknown place',
        coordinates: [2, 1],
        postcode: undefined,
        place: undefined,
        district: undefined,
        region: undefined,
        country: undefined,
        place_type: undefined,
        bbox: undefined,
      });
    });
  });
});
