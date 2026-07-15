import { ApiProperty } from '@nestjs/swagger';
import { PrintableDirectoryLocalizedTextResponseDto } from './printable-directory-localized-text.response.dto';
import { PrintableDirectorySourceResponseDto } from './printable-directory-source.response.dto';

export class PrintableDirectorySectionResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  order: number;

  @ApiProperty({ type: PrintableDirectoryLocalizedTextResponseDto })
  headingLocalized: PrintableDirectoryLocalizedTextResponseDto;

  @ApiProperty({ type: PrintableDirectoryLocalizedTextResponseDto })
  descriptionLocalized: PrintableDirectoryLocalizedTextResponseDto;

  @ApiProperty({ minimum: 1, maximum: 1000 })
  maxResources: number;

  @ApiProperty({ type: [PrintableDirectorySourceResponseDto] })
  sources: PrintableDirectorySourceResponseDto[];
}
