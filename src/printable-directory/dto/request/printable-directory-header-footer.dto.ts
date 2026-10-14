import { ApiProperty, PartialType } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsEnum } from 'class-validator';
import {
  PRINTABLE_DIRECTORY_HEADER_FOOTER_LAYOUT_ITEMS,
  PrintableDirectoryHeaderFooterLayoutItem,
} from 'src/common/schemas/printable-directory.schema';
import { PrintableDirectoryTextLocalizedApiDto } from '../common/text-localized.api-dto';

export class PrintableDirectoryHeaderFooterDto extends PartialType(
  PrintableDirectoryTextLocalizedApiDto,
) {
  @ApiProperty({
    type: [String],
    enum: PRINTABLE_DIRECTORY_HEADER_FOOTER_LAYOUT_ITEMS,
    example: ['logo', 'date'],
  })
  @IsArray()
  @ArrayUnique()
  @IsEnum(PRINTABLE_DIRECTORY_HEADER_FOOTER_LAYOUT_ITEMS, { each: true })
  layout: PrintableDirectoryHeaderFooterLayoutItem[];
}
