import { ApiProperty } from '@nestjs/swagger';

export type AiSearchScenario =
  | 'search'
  | 'clarify_low_info'
  | 'clarify_multiple_labels'
  | 'search_and_notify_low_info'
  | 'search_and_notify_low_confidence';

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
    type: Number,
    nullable: true,
  })
  results_count: number | null;
}

export class AiSearchPredictResponseDto {
  @ApiProperty({
    enum: [
      'search',
      'clarify_low_info',
      'clarify_multiple_labels',
      'search_and_notify_low_info',
      'search_and_notify_low_confidence',
    ],
  })
  scenario: AiSearchScenario;

  @ApiProperty({ type: [String] })
  hsis_taxonomies: string[];

  @ApiProperty({ type: [AiSearchOptionDto] })
  options: AiSearchOptionDto[];
}
