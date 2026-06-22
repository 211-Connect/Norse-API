import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

import { CommonAnalyticsQuery } from './common-query.dto';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

export class SessionsQueryDto extends CommonAnalyticsQuery {
  @ApiProperty({
    description: 'Page number for pagination',
    example: 1,
    default: DEFAULT_PAGE,
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  page: number = DEFAULT_PAGE;

  @ApiProperty({
    description: 'Number of sessions per page',
    example: 100,
    default: DEFAULT_LIMIT,
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit: number = DEFAULT_LIMIT;
}
