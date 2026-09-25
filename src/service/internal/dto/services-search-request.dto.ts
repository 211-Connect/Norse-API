import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { REGION_ID_PATTERN, regionIdMessage } from '../../../region/internal';

export const SERVICES_SEARCH_DEFAULT_LIMIT = 50;
export const SERVICES_SEARCH_MAX_LIMIT = 200;
export const SERVICES_SEARCH_MAX_WRITERS = 100;
/** Regions and points together (ADR 0025). */
export const SERVICES_SEARCH_MAX_PLACES = 20;
export const POINT_RADIUS_MIN_MILES = 0.1;
export const POINT_RADIUS_MAX_MILES = 100;

export const VIRTUAL_MODES = ['all', 'only', 'exclude'] as const;

/** What ties a service to a Place (ADR 0025): its Service Area, or its sites. */
export const MATCH_MODES = ['serves', 'located'] as const;
export type MatchMode = (typeof MATCH_MODES)[number];
export type VirtualMode = (typeof VIRTUAL_MODES)[number];

export class ServicesGeoPointDto {
  @ApiProperty({ minimum: -90, maximum: 90, example: 35.994 })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  lat: number;

  @ApiProperty({ minimum: -180, maximum: 180, example: -78.8986 })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  lng: number;

  @ApiProperty({
    minimum: POINT_RADIUS_MIN_MILES,
    maximum: POINT_RADIUS_MAX_MILES,
    example: 10,
  })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(POINT_RADIUS_MIN_MILES)
  @Max(POINT_RADIUS_MAX_MILES)
  radiusMiles: number;
}

/** Regions and points, OR'ed: 1 to 20 Places in total. */
export class ServicesGeographyFilterDto {
  @ApiProperty({
    type: [String],
    required: false,
    maxItems: SERVICES_SEARCH_MAX_PLACES,
    example: ['county:29510', 'zip:63110'],
    description:
      "Region ids, OR'ed with the points. A service matches when its service_area intersects any of them. A service with a virtual location and no service_area matches every Region unless virtual is exclude; any other service without a service_area never matches. An unknown id is 400.",
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(SERVICES_SEARCH_MAX_PLACES)
  @IsString({ each: true })
  @Matches(REGION_ID_PATTERN, { each: true, message: regionIdMessage })
  regionIds?: string[];

  @ApiProperty({
    type: [ServicesGeoPointDto],
    required: false,
    maxItems: SERVICES_SEARCH_MAX_PLACES,
    description:
      "Points with a radius in miles, OR'ed with the Regions. A service matches when its service_area intersects the circle, under the same rule for Virtual Services with no service_area as a Region.",
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(SERVICES_SEARCH_MAX_PLACES)
  @ValidateNested({ each: true })
  @Type(() => ServicesGeoPointDto)
  points?: ServicesGeoPointDto[];
}

/** The clauses that also narrow facets, so a facet count matches the list. */
export class ServicesScopeFilterDto {
  @ApiProperty({ type: ServicesGeographyFilterDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => ServicesGeographyFilterDto)
  geography?: ServicesGeographyFilterDto;

  @ApiProperty({
    enum: VIRTUAL_MODES,
    required: false,
    default: 'all',
    description:
      'only: some location is virtual. exclude: some location is physical (a service with both appears under both); with geography, exclude also stops a service with no service_area from matching every Region.',
  })
  @IsOptional()
  @IsIn(VIRTUAL_MODES)
  virtual?: VirtualMode;

  @ApiProperty({
    enum: MATCH_MODES,
    required: false,
    default: 'serves',
    description:
      'serves: the service_area intersects a Place. located: a physical location lies inside a Place; under virtual all, Virtual Services that serve it match too, and under only it is the same as serves.',
  })
  @IsOptional()
  @IsIn(MATCH_MODES)
  match?: MatchMode;
}

/**
 * The narrowing clauses of a Selection Filter. An empty or absent clause means
 * "no constraint on this dimension". All clauses are AND'ed.
 */
export class ServicesSearchFilterDto extends ServicesScopeFilterDto {
  @ApiProperty({
    type: [String],
    required: false,
    default: [],
    description:
      'AIRS codes, matched exactly against the ancestor-expanded taxonomyPath, so a node selects its descendants.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  taxonomyCodes?: string[];

  @ApiProperty({ type: [String], required: false, default: [] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  statuses?: string[];
}

/**
 * The Resource Writer set the caller may see. Required; an empty set returns
 * nothing rather than everything.
 */
export class ServicesWriterScopeDto {
  @ApiProperty({
    type: [String],
    maxItems: SERVICES_SEARCH_MAX_WRITERS,
    description: 'Resource Writer ids. An empty list matches no services.',
  })
  @IsArray()
  @ArrayMaxSize(SERVICES_SEARCH_MAX_WRITERS)
  @IsString({ each: true })
  resourceWriterIds: string[];
}

export class ServicesSearchRequestDto extends ServicesWriterScopeDto {
  @ApiProperty({ type: ServicesSearchFilterDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => ServicesSearchFilterDto)
  filter?: ServicesSearchFilterDto;

  @ApiProperty({
    required: false,
    maxLength: 256,
    description:
      'Contains-matches name, and matches name (weighted highest), alternateName, description and organizationName. With text, results are ordered by relevance.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  text?: string;

  @ApiProperty({
    required: false,
    maxLength: 2048,
    description:
      'The nextCursor of the previous page, for the same query. Absent for the first page.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  cursor?: string;

  @ApiProperty({
    required: false,
    default: SERVICES_SEARCH_DEFAULT_LIMIT,
    minimum: 1,
    maximum: SERVICES_SEARCH_MAX_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SERVICES_SEARCH_MAX_LIMIT)
  limit?: number;
}

/**
 * Facets take geography and virtual mode but not taxonomy or status: those
 * are the options being counted.
 */
export class ServicesFacetsRequestDto extends ServicesWriterScopeDto {
  @ApiProperty({ type: ServicesScopeFilterDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => ServicesScopeFilterDto)
  filter?: ServicesScopeFilterDto;
}
