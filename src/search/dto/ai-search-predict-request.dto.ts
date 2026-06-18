import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class AiSearchPredictRequestDto {
  @ApiProperty({ minLength: 1 })
  @IsString()
  @MinLength(1)
  query: string;

  @ApiProperty({
    required: false,
    default: 100,
    minimum: 1,
    description: 'Number of candidates to request from ML Broker (default 100)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  top_k?: number;
}
