import { ApiProperty } from '@nestjs/swagger';

export class AiSearchReRankResponseDto {
  @ApiProperty({ type: [String] })
  hsis_taxonomies: string[];
}
