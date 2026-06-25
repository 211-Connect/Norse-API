import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsObject, IsOptional, Min } from 'class-validator';
import { IsStringNumberRecord } from 'src/common/dto/is-string-number-record';

export class AiSearchReRankRequestDto {
  @ApiProperty({
    description:
      'Need code to score mapping forwarded directly to ML Broker as need_weights',
    type: 'object',
    additionalProperties: { type: 'number' },
    example: {
      'HO-300': 0.907,
      'IC-330': 0.0817,
    },
  })
  @IsObject()
  @IsStringNumberRecord()
  need_weights: Record<string, number>;

  @ApiProperty({
    required: false,
    default: 150,
    minimum: 1,
    description: 'Number of candidates to request from ML Broker (default 150)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  top_k?: number;
}
