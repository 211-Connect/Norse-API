import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { CommonAnalyticsQuery } from './common-query.dto';

export class EventValuesQueryDto extends CommonAnalyticsQuery {
  @ApiProperty({
    description: 'Umami event name (e.g. search_zero_results)',
    example: 'search_zero_results',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  event: string;

  @ApiProperty({
    description: 'Property name to retrieve distinct values for',
    example: 'query',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  property: string;
}
