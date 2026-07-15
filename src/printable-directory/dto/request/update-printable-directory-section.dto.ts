import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { CreatePrintableDirectorySectionDto } from './create-printable-directory-section.dto';

export class UpdatePrintableDirectorySectionDto extends PartialType(
  OmitType(CreatePrintableDirectorySectionDto, ['sources']),
) {
  @ApiPropertyOptional({ minimum: 1, maximum: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  maxResources?: number;
}
