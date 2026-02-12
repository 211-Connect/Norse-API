import { ApiProperty } from '@nestjs/swagger';

export class PaginationResponseDto {
  @ApiProperty({
    description: 'Total number of matching results',
    example: 40,
  })
  total: number;

  @ApiProperty({
    description: 'Current page number',
    example: 1,
  })
  page: number;
}
