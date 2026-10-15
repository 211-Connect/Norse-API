import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { SERVICES_SEARCH_MAX_WRITERS } from './services-search-request.dto';

export const TAXONOMY_NAMES_MAX_CODES = 5000;

export class TaxonomyNamesRequestDto {
  @ApiProperty({
    type: [String],
    minItems: 1,
    maxItems: SERVICES_SEARCH_MAX_WRITERS,
    description: 'Resource Writer ids whose own names to return.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(SERVICES_SEARCH_MAX_WRITERS)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  resourceWriterIds: string[];

  @ApiProperty({
    type: [String],
    minItems: 1,
    maxItems: TAXONOMY_NAMES_MAX_CODES,
    example: ['BD-1800.2000', 'BH'],
    description:
      'Taxonomy codes, matched in normalized form (trimmed, trailing `.` or `-` dropped: `BD-1800.` matches `BD-1800`). The response keys each name by the code as sent.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(TAXONOMY_NAMES_MAX_CODES)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  codes: string[];

  @ApiProperty({
    required: false,
    default: 'en',
    example: 'es',
    description:
      'Locale of the names. A code with no name in this locale is omitted; there is no fallback to another locale.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  locale?: string;
}

export class TaxonomyNamesResponseDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: {
      type: 'object',
      additionalProperties: { type: 'string' },
    },
    example: { 'writer-a': { 'BD-1800.2000': 'Food Pantries' } },
    description:
      "Resource Writer id → requested code → that writer's own name. Writers and codes with no name are omitted.",
  })
  names: Record<string, Record<string, string>>;
}
