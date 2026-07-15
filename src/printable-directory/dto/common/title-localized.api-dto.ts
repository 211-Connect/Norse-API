import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';
import { PrintableDirectoryLocalizedValuesDto } from './localized-values.dto';

export class PrintableDirectoryTitleLocalizedApiDto {
  @ApiProperty({ type: PrintableDirectoryLocalizedValuesDto })
  @ValidateNested()
  @Type(() => PrintableDirectoryLocalizedValuesDto)
  titleLocalized: PrintableDirectoryLocalizedValuesDto;
}
