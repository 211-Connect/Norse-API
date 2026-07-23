import { ApiPropertyOptional, IntersectionType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { PrintableDirectorySectionSourceDto } from './printable-directory-section-source.dto';
import { PrintableDirectoryHeadingLocalizedApiDto } from '../common/heading-localized.api-dto';
import { PrintableDirectoryDescriptionLocalizedApiDto } from '../common/description-localized.api-dto';

export class CreatePrintableDirectorySectionDto extends IntersectionType(
  PrintableDirectoryHeadingLocalizedApiDto,
  PrintableDirectoryDescriptionLocalizedApiDto,
) {
  @ApiPropertyOptional({ minimum: 1, maximum: 1000, default: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  maxResources?: number;

  @ApiPropertyOptional({ type: [PrintableDirectorySectionSourceDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PrintableDirectorySectionSourceDto)
  sources?: PrintableDirectorySectionSourceDto[];
}
