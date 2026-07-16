import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class TaxonomySearchQueryDto {
  @ApiPropertyOptional({
    description: 'Search query for taxonomy name or code',
    default: '',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  query: string = '';

  @ApiPropertyOptional({
    description: 'Deprecated taxonomy code filter',
    deprecated: true,
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
