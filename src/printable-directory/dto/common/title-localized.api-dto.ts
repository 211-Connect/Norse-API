import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';
import { PrintableDirectoryLocalizedValuesDto } from './localized-values.dto';
import {
  PRINTABLE_DIRECTORY_SHORT_TEXT_MAX_LENGTH,
  MaxLocalizedValueLength,
} from './max-localized-value-length.validator';

export class PrintableDirectoryTitleLocalizedApiDto {
  @ApiProperty({
    type: PrintableDirectoryLocalizedValuesDto,
    description: `Each value is at most ${PRINTABLE_DIRECTORY_SHORT_TEXT_MAX_LENGTH} characters.`,
  })
  @ValidateNested()
  @MaxLocalizedValueLength(PRINTABLE_DIRECTORY_SHORT_TEXT_MAX_LENGTH)
  @Type(() => PrintableDirectoryLocalizedValuesDto)
  titleLocalized: PrintableDirectoryLocalizedValuesDto;
}
