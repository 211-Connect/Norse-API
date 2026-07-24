import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class SearchScorecardTaxonomiesQueryDto {
  @ApiProperty({
    description: 'Tenant identifier used to filter taxonomy search results',
    example: 'bad518d2-c4f3-4e41-9692-17b48f2f384e',
  })
  @IsString()
  @MaxLength(128)
  tenant_id: string;

  @ApiProperty({
    description: 'Search query for taxonomy name/code',
    example: 'BD',
  })
  @IsString()
  @MaxLength(120)
  query: string;

  @ApiProperty({
    type: Number,
    required: false,
    default: 1,
    minimum: 1,
    description: 'Pagination page index',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiProperty({
    type: Number,
    required: false,
    default: 10,
    minimum: 1,
    maximum: 100,
    description: 'Page size',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 10;
}
