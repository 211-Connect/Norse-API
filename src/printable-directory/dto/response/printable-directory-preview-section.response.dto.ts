import { ApiProperty } from '@nestjs/swagger';
import { PrintableDirectoryPreviewSectionResourceDto } from './printable-directory-preview-section-resource.response.dto';
import { PrintableDirectorySectionResponseDto } from './printable-directory-section.response.dto';

export class PrintableDirectoryPreviewSectionDto extends PrintableDirectorySectionResponseDto {
  @ApiProperty({ example: 'Housing' })
  resolvedHeading: string;

  @ApiProperty({ example: 'English fallback text' })
  resolvedDescription: string;

  @ApiProperty({ type: [PrintableDirectoryPreviewSectionResourceDto] })
  resources: PrintableDirectoryPreviewSectionResourceDto[];
}
