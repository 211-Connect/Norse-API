import { ApiProperty } from '@nestjs/swagger';

export type AiSearchScenario = 'clarify' | 'search' | 'search_and_notify';

export class AiSearchOptionDto {
  @ApiProperty()
  code: string;

  @ApiProperty()
  score: number;

  @ApiProperty({
    description: 'Whether this need should be pre-selected in UI',
  })
  pre_selected: boolean;

  @ApiProperty({
    description: 'Number of results for this need',
    nullable: true,
  })
  results_count: number | null;
}

export class AiSearchPredictResponseDto {
  @ApiProperty({ enum: ['clarify', 'search', 'search_and_notify'] })
  scenario: AiSearchScenario;

  @ApiProperty({ type: [String] })
  hsis_taxonomies: string[];

  @ApiProperty({ type: [AiSearchOptionDto] })
  options: AiSearchOptionDto[];
}
