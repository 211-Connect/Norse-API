import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SearchResponseDto } from '../../../search/dto/search-response.dto';

export class V2IntentNeedDto {
  @ApiProperty({ example: 'N-HOU-02', description: 'SUNE need code.' })
  value: string;

  @ApiProperty({ enum: ['caller', 'inferred'] })
  source: 'caller' | 'inferred';

  @ApiProperty({
    enum: ['use', 'ask'],
    description: '`use` boosts results. `ask` is offered as a question option.',
  })
  state: 'use' | 'ask';

  @ApiPropertyOptional({ description: 'Model score; inferred needs only.' })
  confidence?: number;
}

export class V2IntentUrgencyDto {
  @ApiProperty({ enum: ['U-0', 'U-1', 'U-2', 'U-3', 'U-4', 'U-X'] })
  value: string;

  @ApiProperty({ enum: ['caller', 'inferred', 'default'] })
  source: 'caller' | 'inferred' | 'default';

  @ApiProperty({ enum: ['use', 'ask', 'drop'] })
  state: 'use' | 'ask' | 'drop';
}

export class V2IntentDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The typed query when it is a string with text, else null.',
  })
  query: string | null;

  @ApiProperty({ type: [V2IntentNeedDto] })
  needs: V2IntentNeedDto[];

  @ApiProperty({ type: V2IntentUrgencyDto })
  urgency: V2IntentUrgencyDto;
}

export class V2QuestionOptionDto {
  @ApiProperty()
  value: string;

  @ApiProperty()
  label: string;

  @ApiPropertyOptional()
  results_count?: number;
}

export class V2HotlineDto {
  @ApiProperty()
  label: string;

  @ApiProperty()
  number: string;
}

export class V2QuestionDto {
  @ApiProperty() id: string;
  @ApiProperty({
    enum: ['emergency', 'confirm_urgency', 'find_need', 'narrow'],
  })
  type: string;
  @ApiProperty({ enum: ['red', 'orange', 'low'] }) level: string;
  @ApiProperty({ enum: ['critical', 'high', 'medium', 'low'] })
  importance: string;
  @ApiProperty() value: number;
  @ApiProperty() priority: number;
  @ApiProperty() uncertainty: number;
  @ApiProperty() reason: string;
  @ApiProperty() step: number;
  @ApiProperty({ enum: ['urgency', 'needs'] }) parameter: string;
  @ApiProperty() stem: string;
  @ApiProperty({ type: [V2QuestionOptionDto] })
  options: V2QuestionOptionDto[];
  @ApiProperty() multi_select: boolean;
  @ApiProperty() allow_other: boolean;
  @ApiProperty() none_of_these: boolean;
  @ApiPropertyOptional({ type: [V2HotlineDto] })
  hotlines?: V2HotlineDto[];
}

export class V2ClarificationDto {
  @ApiProperty() rules_version: string;

  @ApiProperty({ type: [V2QuestionDto], description: 'At most 3, ranked.' })
  questions: V2QuestionDto[];
}

export class V2EmergencyDto {
  @ApiProperty({ enum: ['popup', 'soft', 'none', 'unknown'] })
  band: 'popup' | 'soft' | 'none' | 'unknown';

  @ApiProperty() show_hotline: boolean;
}

/** Draft until the v2 ADR (ISS-2493). */
export class V2SearchResponseDto extends SearchResponseDto {
  @ApiProperty({ type: V2IntentDto }) intent: V2IntentDto;
  @ApiProperty({ type: V2ClarificationDto }) clarification: V2ClarificationDto;
  @ApiProperty({ type: V2EmergencyDto }) emergency: V2EmergencyDto;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Null when classification was skipped or failed.',
  })
  model_version: string | null;
  @ApiProperty() rules_version: string;
}
