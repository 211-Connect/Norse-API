import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  Validate,
} from 'class-validator';
import { SEARCH_QUERY_TYPES, SearchQueryType } from './search-query-type';
import { Transform } from 'class-transformer';
import { ORGANIZATION_ID_DESCRIPTION, toRegionIds } from './search-query.dto';
import { REGION_ID_PATTERN, regionIdMessage } from 'src/region/internal';
import {
  AREA_MATCH_PARAM_DESCRIPTION,
  AREA_MATCH_VALUES,
  AreaMatch,
  UNLOCATED_PARAM_DESCRIPTION,
  UNLOCATED_VALUES,
  Unlocated,
  MAX_REGION_IDS,
  REGION_PARAM_DESCRIPTION,
} from '../internal/area/area-match';
import { IsWithinMaxResultWindowConstraint } from 'src/common/dto/es-result-window.validator';

export class SearchQueryApiDto {
  @ApiPropertyOptional({
    description:
      'Search query expression. Can be plain text, string array, or nested AND/OR object payload.',
    oneOf: [
      { type: 'string' },
      { type: 'array', items: { type: 'string' } },
      { type: 'object', additionalProperties: true },
    ],
    example: 'housing',
  })
  @IsOptional()
  query?: string | string[] | Record<string, unknown>;

  @ApiPropertyOptional({
    enum: SEARCH_QUERY_TYPES,
    default: 'text',
  })
  @IsOptional()
  @IsEnum(SEARCH_QUERY_TYPES)
  query_type?: SearchQueryType;

  @ApiPropertyOptional({
    minimum: 1,
    default: 1,
    description:
      'Result offset must stay within Elasticsearch max_result_window: ' +
      'page * limit may not exceed 10000 (defaults to limit 25 when omitted).',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Validate(IsWithinMaxResultWindowConstraint)
  page?: number;

  @ApiPropertyOptional({
    description: 'Comma-delimited longitude,latitude',
    example: '-120.740135,47.751076',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  coords?: string;

  @ApiPropertyOptional({
    description: REGION_PARAM_DESCRIPTION,
    type: String,
    example: 'county:53077',
  })
  @IsOptional()
  @Transform(({ value }) => toRegionIds(value))
  @IsArray()
  @ArrayMaxSize(MAX_REGION_IDS)
  @IsString({ each: true })
  @Matches(REGION_ID_PATTERN, { each: true, message: regionIdMessage })
  region?: string[];

  @ApiPropertyOptional({
    description: AREA_MATCH_PARAM_DESCRIPTION,
    enum: AREA_MATCH_VALUES,
  })
  @IsOptional()
  @IsIn(AREA_MATCH_VALUES)
  area_match?: AreaMatch;

  @ApiPropertyOptional({
    description: UNLOCATED_PARAM_DESCRIPTION,
    enum: UNLOCATED_VALUES,
  })
  @IsOptional()
  @IsIn(UNLOCATED_VALUES)
  unlocated?: Unlocated;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { county: 'King', language: ['en', 'es'] },
  })
  @IsOptional()
  @IsObject()
  filters?: Record<string, string | string[]>;

  @ApiPropertyOptional({
    description: 'HSIS taxonomy scope as comma-delimited string or array',
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    example: 'BM-1400,BM-1700',
  })
  @IsOptional()
  taxonomy?: string | string[];

  @ApiPropertyOptional({
    description: ORGANIZATION_ID_DESCRIPTION,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  organization_id?: string;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  distance?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  age?: number;

  @ApiPropertyOptional({ minimum: 25, maximum: 300, default: 25 })
  @IsOptional()
  @IsInt()
  @Min(25)
  @Max(300)
  limit?: number;

  @ApiPropertyOptional({ enum: ['boundary', 'proximity'] })
  @IsOptional()
  @IsEnum(['boundary', 'proximity'])
  geo_type?: 'boundary' | 'proximity';

  @ApiPropertyOptional({
    enum: ['relevance', 'distance', 'name', 'organization'],
    default: 'relevance',
  })
  @IsOptional()
  @IsEnum(['relevance', 'distance', 'name', 'organization'])
  sort?: 'relevance' | 'distance' | 'name' | 'organization';
}

export class SearchBodyApiDto {
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'GeoJSON geometry payload for POST /search',
  })
  @IsOptional()
  @IsObject()
  geometry?: Record<string, unknown>;
}
