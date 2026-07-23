import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PRINTABLE_DIRECTORY_HEADER_FOOTER_LAYOUT_ITEMS,
  PrintableDirectoryHeaderFooterLayoutItem,
} from 'src/common/schemas/printable-directory.schema';
import { PrintableDirectoryLocalizedTextResponseDto } from './printable-directory-localized-text.response.dto';

export class PrintableDirectoryHeaderFooterResponseDto {
  @ApiProperty({
    type: [String],
    enum: PRINTABLE_DIRECTORY_HEADER_FOOTER_LAYOUT_ITEMS,
    example: ['text', 'logo', 'domain', 'date'],
  })
  layout: PrintableDirectoryHeaderFooterLayoutItem[];

  @ApiPropertyOptional({ type: PrintableDirectoryLocalizedTextResponseDto })
  textLocalized?: PrintableDirectoryLocalizedTextResponseDto;

  @ApiPropertyOptional({ type: String, nullable: true })
  logoUrl?: string | null;
}
