import { ApiProperty } from '@nestjs/swagger';

export class ScorecardTaxonomyItemDto {
  @ApiProperty({ example: 'BD-4000.300' })
  code: string;

  @ApiProperty({ example: 'Food Pantries' })
  name: string;
}

export class SearchScorecardTaxonomiesResponseDto {
  @ApiProperty({ example: 2112 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 10 })
  limit: number;

  @ApiProperty({ type: [ScorecardTaxonomyItemDto] })
  items: ScorecardTaxonomyItemDto[];
}
