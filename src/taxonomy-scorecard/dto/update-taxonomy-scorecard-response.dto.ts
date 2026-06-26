import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateTaxonomyScorecardResponseDto {
  @ApiProperty({ example: 'bad518d2-c4f3-4e41-9692-17b48f2f384e' })
  tenant_id: string;

  @ApiProperty({ type: [String], example: ['BD', 'BD-100.2000'] })
  affected_codes: string[];

  @ApiPropertyOptional({
    type: [String],
    example: ['BD', 'BD-100.2000'],
    description:
      'Taxonomies that would be impacted if a draft version is enabled',
  })
  potentially_affected_codes?: string[];

  @ApiProperty({ example: 2 })
  new_version_count: number;
}
