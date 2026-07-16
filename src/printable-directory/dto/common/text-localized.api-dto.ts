import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';
import { PrintableDirectoryLocalizedValuesDto } from './localized-values.dto';

export class PrintableDirectoryTextLocalizedApiDto {
  @ApiProperty({ type: PrintableDirectoryLocalizedValuesDto })
  @ValidateNested()
  @Type(() => PrintableDirectoryLocalizedValuesDto)
  textLocalized: PrintableDirectoryLocalizedValuesDto;
}
