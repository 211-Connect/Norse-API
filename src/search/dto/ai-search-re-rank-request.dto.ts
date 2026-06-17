import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';
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
}
