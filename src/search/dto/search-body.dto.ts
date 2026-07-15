import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

const GEOJSON_TYPES = [
  'Point',
  'MultiPoint',
  'LineString',
  'MultiLineString',
  'Polygon',
  'MultiPolygon',
] as const;

type GeoJsonType = (typeof GEOJSON_TYPES)[number];

const isPosition = (value: unknown): value is number[] => {
  if (!Array.isArray(value) || value.length < 2 || value.length > 3) {
    return false;
  }

  return value.every((coordinate) => typeof coordinate === 'number');
};

const isPositionArray = (value: unknown): value is number[][] =>
  Array.isArray(value) && value.every(isPosition);

const isPositionArray2D = (value: unknown): value is number[][][] =>
  Array.isArray(value) && value.every(isPositionArray);

const isPositionArray3D = (value: unknown): value is number[][][][] =>
  Array.isArray(value) && value.every(isPositionArray2D);

const isValidGeometry = (value: unknown): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const geometry = value as { type?: unknown; coordinates?: unknown };

  if (
    typeof geometry.type !== 'string' ||
    !GEOJSON_TYPES.includes(geometry.type as GeoJsonType)
  ) {
    return false;
  }

  switch (geometry.type) {
    case 'Point':
      return isPosition(geometry.coordinates);
    case 'MultiPoint':
    case 'LineString':
      return isPositionArray(geometry.coordinates);
    case 'MultiLineString':
    case 'Polygon':
      return isPositionArray2D(geometry.coordinates);
    case 'MultiPolygon':
      return isPositionArray3D(geometry.coordinates);
    default:
      return false;
  }
};

@ValidatorConstraint({ name: 'isGeoJsonGeometry', async: false })
class IsGeoJsonGeometryConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (value === undefined || value === null) {
      return true;
    }

    return isValidGeometry(value);
  }

  defaultMessage(): string {
    return 'geometry must be a valid GeoJSON geometry object';
  }
}

export class SearchResourcesBodyDto {
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'GeoJSON geometry payload',
  })
  @IsOptional()
  @Validate(IsGeoJsonGeometryConstraint)
  geometry?: Record<string, unknown>;
}
