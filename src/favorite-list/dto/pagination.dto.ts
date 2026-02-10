import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(300).min(1).default(25),
  search: z.string().optional(),
});

export class PaginationDto {
  @ApiProperty({ required: false, default: 1 })
  page: number;

  @ApiProperty({ required: false, default: 25 })
  limit: number;

  @ApiPropertyOptional()
  search?: string;
}
