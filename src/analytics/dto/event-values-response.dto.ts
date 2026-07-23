import { ApiProperty } from '@nestjs/swagger';

export class EventValuesResponse {
  @ApiProperty({
    description: 'Distinct property value',
    example: 'homeless shelter',
  })
  value: string;

  @ApiProperty({
    description: 'Total occurrences of this value',
    example: 42,
  })
  total: number;
}
