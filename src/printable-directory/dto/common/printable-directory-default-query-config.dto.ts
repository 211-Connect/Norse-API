import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class PrintableDirectoryDefaultQueryConfigDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 200,
    example: 'Seattle, WA',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  locationName?: string | null;

  @ApiPropertyOptional({
    type: [Number],
    nullable: true,
    minItems: 2,
    maxItems: 2,
    example: [-122.3321, 47.6062],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @IsNumber({}, { each: true })
  coords?: [number, number] | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: 0,
    maximum: 1000,
    example: 25,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  radius?: number | null;
}
