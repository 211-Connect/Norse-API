import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class AiSearchPredictRequestDto {
  @ApiProperty({ minLength: 1 })
  @IsString()
  @MinLength(1)
  query: string;
}
