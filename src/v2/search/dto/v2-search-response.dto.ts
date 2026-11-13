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

/** One answer. A pick adds `value` to the URL parameter `parameter` (ADR 0039 Decision 55). */
export class V2QuestionOptionDto {
  @ApiProperty({ example: 'Help paying rent' })
  label: string;

  @ApiProperty({
    enum: ['needs', 'passed_needs', 'urgency'],
    description:
      'The URL parameter that a pick of this option adds. One question can mix kinds.',
  })
  parameter: 'needs' | 'passed_needs' | 'urgency';

  @ApiProperty({
    example: 'N-HOU-02',
    description:
      'The value added to that parameter, for example N-HOU-02 or U-3.',
  })
  value: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Services that match this option; null when the server did not count (all urgency options, and need options when no count ran). A counted option keeps its number. An option with count 0 is never offered.',
  })
  // Optional in TS only: the rules engine's finalize always sets it (null when not counted).
  results_count?: number | null;
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
  @ApiProperty({ enum: ['critical', 'high', 'medium', 'low'] })
  importance: string;
  @ApiProperty() value: number;
  @ApiProperty() priority: number;
  @ApiProperty() uncertainty: number;
  @ApiProperty() reason: string;
  @ApiProperty() step: number;
  @ApiProperty() stem: string;
  @ApiProperty({
    type: [V2QuestionOptionDto],
    description:
      'Emergency question: urgency answers only, never U-0; empty for a caller `urgency=U-0`.',
  })
  options: V2QuestionOptionDto[];
  @ApiProperty() multi_select: boolean;
  @ApiProperty() allow_other: boolean;
  @ApiProperty() none_of_these: boolean;
  @ApiPropertyOptional({
    type: [V2HotlineDto],
    description: 'Emergency question only. One tap calls a number.',
  })
  hotlines?: V2HotlineDto[];
}

export class V2ClarificationDto {
  @ApiProperty() rules_version: string;

  @ApiProperty({ type: [V2QuestionDto], description: 'At most 3, ranked.' })
  questions: V2QuestionDto[];
}

/**
 * Draft until the v2 ADR (ISS-2493). No top-level emergency block: the
 * emergency is only the emergency question in `clarification` (ADR 0039
 * Decision 54).
 */
export class V2SearchResponseDto extends SearchResponseDto {
  @ApiProperty({ type: V2IntentDto }) intent: V2IntentDto;
  @ApiProperty({ type: V2ClarificationDto }) clarification: V2ClarificationDto;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Null when classification was skipped or failed.',
  })
  model_version: string | null;
  @ApiProperty() rules_version: string;
}
