import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { REGION_ID_PATTERN } from '../../../region/internal/dto';

export const SERVICES_SEARCH_DEFAULT_LIMIT = 50;
export const SERVICES_SEARCH_MAX_LIMIT = 200;
export const SERVICES_SEARCH_MAX_WRITERS = 100;
export const SERVICES_SEARCH_MAX_REGIONS = 20;

export const VIRTUAL_MODES = ['all', 'only', 'exclude'] as const;
export type VirtualMode = (typeof VIRTUAL_MODES)[number];

export class ServicesGeographyFilterDto {
  @ApiProperty({
    type: [String],
    minItems: 1,
    maxItems: SERVICES_SEARCH_MAX_REGIONS,
    example: ['county:29510', 'zip:63110'],
    description:
      "Region ids, OR'ed. A service matches when its service_area intersects any of them; a service without one never matches. An unknown id is 400.",
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(SERVICES_SEARCH_MAX_REGIONS)
  @IsString({ each: true })
  @Matches(REGION_ID_PATTERN, {
    each: true,
    message:
      'each regionId must be state:XX, county:<5-digit FIPS> or zip:<5 digits>',
  })
  regionIds: string[];
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
      'only: some location is virtual. exclude: some location is physical (a service with both appears under both).',
  })
  @IsOptional()
  @IsIn(VIRTUAL_MODES)
  virtual?: VirtualMode;
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
