import {
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
} from '@nestjs/swagger';

export class ScorecardNeedResponseDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    example: { 'FO-200': 0.9, 'EM-100': 0.1 },
  })
  weights: Record<string, number>;

  @ApiProperty({ example: 'FO-200', nullable: true })
  top_category_code: string | null;

  @ApiProperty({ example: 0.9, nullable: true })
  top_weight: number | null;

  @ApiProperty({ type: [String], example: ['FO-200', 'EM-100'] })
  need_categories_present: string[];
}

export class TaxonomyScorecardPayloadResponseDto {
  @ApiProperty({ type: ScorecardNeedResponseDto })
  need: ScorecardNeedResponseDto;

  @ApiPropertyOptional({ type: 'object', nullable: true, example: null })
  target_population?: unknown | null;

  @ApiPropertyOptional({ type: 'object', nullable: true, example: null })
  urgency?: unknown | null;
}

export class TaxonomySourceResponseDto {
  @ApiProperty({ example: 'default' })
  owner: string;

  @ApiProperty({ example: null, nullable: true })
  customization_version: string | null;

  @ApiProperty({ example: true })
  isProduction: boolean;

  @ApiProperty({ example: '2026-06-05T12:00:00.000Z' })
  published_at: string;
}

export class ScorecardVersionEntryResponseDto {
  @ApiProperty({ example: '0' })
  version_id: string;

  @ApiProperty({ type: TaxonomyScorecardPayloadResponseDto })
  scorecard: TaxonomyScorecardPayloadResponseDto;

  @ApiProperty({ type: TaxonomySourceResponseDto })
  source: TaxonomySourceResponseDto;

  @ApiProperty({ example: '2026-06-05T12:00:00.000Z' })
  created_at: string;

  @ApiProperty({
    example: 'admin@payload.local',
    nullable: true,
    required: false,
  })
  created_by_email?: string | null;
}

export class VersionMetadataResponseDto {
  @ApiProperty({ example: 3 })
  next_version: number;

  @ApiProperty({ example: 2, nullable: true })
  active_version: number | null;

  @ApiProperty({ example: 'update', enum: ['update', 'enable'] })
  last_action: 'update' | 'enable';
}

export class TaxonomyScorecardResponseDto {
  @ApiProperty({ example: 'BD::default' })
  _id: string;

  @ApiProperty({ example: 'BD' })
  hsis_code: string;

  @ApiProperty({ example: 'Food' })
  hsis_name: string;

  @ApiProperty({ example: null, nullable: true })
  scorecard_version: string | null;

  @ApiProperty({ example: null, nullable: true })
  taxonomy_version: string | null;

  @ApiProperty({ type: TaxonomyScorecardPayloadResponseDto })
  scorecard: TaxonomyScorecardPayloadResponseDto;

  @ApiProperty({ type: [String], example: ['need'] })
  components_available: string[];

  @ApiProperty({ type: TaxonomySourceResponseDto })
  source: TaxonomySourceResponseDto;

  @ApiProperty({
    type: 'object',
    additionalProperties: {
      $ref: getSchemaPath(ScorecardVersionEntryResponseDto),
    },
    example: {
      '0': {
        version_id: '0',
        scorecard: {
          need: {
            weights: { 'FO-200': 0.9 },
            top_category_code: 'FO-200',
            top_weight: 0.9,
            need_categories_present: ['FO-200'],
          },
          target_population: null,
          urgency: null,
        },
        source: {
          owner: 'tenant-1',
          customization_version: null,
          isProduction: true,
          published_at: '2026-06-05T12:00:00.000Z',
        },
        created_at: '2026-06-05T12:00:00.000Z',
      },
    },
  })
  versions: Record<string, ScorecardVersionEntryResponseDto>;

  @ApiProperty({ type: VersionMetadataResponseDto })
  version_metadata: VersionMetadataResponseDto;

  @ApiProperty({
    example: 'admin@payload.local',
    nullable: true,
    required: false,
  })
  updated_by_email?: string | null;

  @ApiProperty({ example: '2026-06-05T12:00:00.000Z' })
  updated_at: string;
}
