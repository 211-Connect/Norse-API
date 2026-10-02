import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TopicSubtopicConfigItemDto {
  @ApiPropertyOptional()
  id?: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } })
  names: Record<string, string>;

  @ApiPropertyOptional()
  queryType?: string;

  @ApiPropertyOptional()
  query?: string;

  @ApiPropertyOptional()
  href?: string;

  @ApiPropertyOptional()
  target?: string;
}

export class TopicConfigItemDto {
  @ApiPropertyOptional()
  id?: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } })
  names: Record<string, string>;

  @ApiPropertyOptional()
  image?: string;

  @ApiPropertyOptional()
  href?: string;

  @ApiPropertyOptional()
  target?: string;

  @ApiProperty({ type: [TopicSubtopicConfigItemDto] })
  subtopics: TopicSubtopicConfigItemDto[];
}

export class TopicsConfigResponseDto {
  @ApiProperty()
  tenantId: string;

  @ApiProperty()
  iconSize: string;

  @ApiProperty()
  imageBorderRadius: string;

  @ApiPropertyOptional()
  backText?: string;

  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } })
  backTexts: Record<string, string>;

  @ApiPropertyOptional()
  customHeading?: string;

  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } })
  customHeadings: Record<string, string>;

  @ApiProperty({ type: [TopicConfigItemDto] })
  list: TopicConfigItemDto[];
}
