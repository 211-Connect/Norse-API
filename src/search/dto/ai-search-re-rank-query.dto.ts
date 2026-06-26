import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export type AiSearchReRankPayload = {
  need_weights: Record<string, number>;
  top_k?: number;
};

export class AiSearchReRankQueryDto {
  @ApiProperty({
    description:
      'JSON string map of need weights, URL-encoded in query (e.g. {"HO-300":0.907,"IC-330":0.0817})',
    type: 'string',
  })
  @IsString()
  @MaxLength(10000)
  need_weights: string;

  @ApiProperty({
    required: false,
    default: 150,
    minimum: 1,
    description: 'Number of candidates to request from ML Broker (default 150)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  top_k?: number;
}
