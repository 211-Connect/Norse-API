import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SuggestionConfigItemDto {
  @ApiPropertyOptional()
  id?: string;

  @ApiProperty()
  taxonomies: string;

  @ApiProperty()
  value: string;

  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } })
  values: Record<string, string>;
}

export class SuggestionsConfigResponseDto {
  @ApiProperty()
  tenantId: string;

  @ApiProperty({ type: [SuggestionConfigItemDto] })
  suggestions: SuggestionConfigItemDto[];
}
