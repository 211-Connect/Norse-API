import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  SearchBodyApiDto,
  SearchQueryApiDto,
} from 'src/search/dto/search-query.api.dto';

export class PrintableDirectorySourceQueryDto {
  @ApiPropertyOptional({ example: 'Housing Search Block' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiProperty({
    description:
      'Serialized search query parameters aligned with /search API query contract',
    type: SearchQueryApiDto,
    example: { query: 'housing', query_type: 'text', page: 1, limit: 25 },
  })
  @ValidateNested()
  @Type(() => SearchQueryApiDto)
  params: SearchQueryApiDto;

  @ApiPropertyOptional({
    description: 'Optional serialized /search POST body',
    type: SearchBodyApiDto,
    example: { geometry: { type: 'Point', coordinates: [-120.7, 47.7] } },
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => SearchBodyApiDto)
  body?: SearchBodyApiDto;
}
