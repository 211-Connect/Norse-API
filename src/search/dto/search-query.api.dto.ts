import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

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
    enum: ['text', 'taxonomy', 'organization', 'more_like_this', 'hybrid'],
    default: 'text',
  })
  @IsOptional()
  @IsEnum(['text', 'taxonomy', 'organization', 'more_like_this', 'hybrid'])
  query_type?:
    | 'text'
    | 'taxonomy'
    | 'organization'
    | 'more_like_this'
    | 'hybrid';

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
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
