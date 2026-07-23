import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class SuggestionSearchQueryDto {
  @ApiPropertyOptional({
    description: 'Search query for taxonomy name or code',
    default: '',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  query: string = '';

  @ApiPropertyOptional({
    description: 'Taxonomy code filter',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  code?: string;

  @ApiPropertyOptional({
    description: 'Page number for pagination',
    minimum: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;
}
