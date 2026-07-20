import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class PrintableDirectoryCoordsDto {
  @ApiPropertyOptional({
    type: Number,
    minimum: -90,
    maximum: 90,
    example: 47.6062,
  })
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @ApiPropertyOptional({
    type: Number,
    minimum: -180,
    maximum: 180,
    example: -122.3321,
  })
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;
}

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
    type: PrintableDirectoryCoordsDto,
    nullable: true,
    example: { latitude: 47.6062, longitude: -122.3321 },
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PrintableDirectoryCoordsDto)
  coords?: PrintableDirectoryCoordsDto | null;

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
