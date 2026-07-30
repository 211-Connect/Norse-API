import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PRINTABLE_DIRECTORY_COVER_LAYOUTS,
  PrintableDirectoryCoverLayout,
} from 'src/common/schemas/printable-directory.schema';
import { PrintableDirectoryLocalizedTextResponseDto } from './printable-directory-localized-text.response.dto';

export class PrintableDirectoryCoverResponseDto {
  @ApiProperty({ type: PrintableDirectoryLocalizedTextResponseDto })
  titleLocalized: PrintableDirectoryLocalizedTextResponseDto;

  @ApiProperty({ type: PrintableDirectoryLocalizedTextResponseDto })
  descriptionLocalized: PrintableDirectoryLocalizedTextResponseDto;

  @ApiPropertyOptional({ type: String, nullable: true })
  primaryColor?: string | null;

  @ApiProperty({ enum: PRINTABLE_DIRECTORY_COVER_LAYOUTS, example: 'default' })
  layoutType: PrintableDirectoryCoverLayout;

  @ApiPropertyOptional({ type: String, nullable: true })
  coverImageUrlFront?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  coverImageUrlBack?: string | null;
}
