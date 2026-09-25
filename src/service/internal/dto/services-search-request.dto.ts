import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export const SERVICES_SEARCH_DEFAULT_LIMIT = 50;
export const SERVICES_SEARCH_MAX_LIMIT = 200;
export const SERVICES_SEARCH_MAX_WRITERS = 100;

/**
 * The narrowing clauses of a Selection Filter. An empty or absent clause means
 * "no constraint on this dimension". Geography and virtual mode (ISS-1873,
 * ISS-1874) are added here as further optional fields.
 */
export class ServicesSearchFilterDto {
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

export class ServicesFacetsRequestDto extends ServicesWriterScopeDto {}
