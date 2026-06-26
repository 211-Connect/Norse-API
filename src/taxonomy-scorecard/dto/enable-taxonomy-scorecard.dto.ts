import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class EnableTaxonomyScorecardDto {
  @ApiProperty({
    description: 'Version identifier to enable',
    example: 2,
    minimum: 0,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  version_id: number;
}
