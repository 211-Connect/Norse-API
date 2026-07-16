import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import { PrintableDirectoryPreviewSectionDto } from './printable-directory-preview-section.response.dto';
import { PrintableDirectoryResponseDto } from './printable-directory.response.dto';

export class PrintableDirectoryPreviewResponseDto extends PrintableDirectoryResponseDto {
  @Expose()
  @ApiProperty()
  directoryId: string;

  @Expose()
  @ApiProperty()
  locale: string;

  @Expose()
  @Type(() => PrintableDirectoryPreviewSectionDto)
  @ApiProperty({ type: [PrintableDirectoryPreviewSectionDto] })
  sections: PrintableDirectoryPreviewSectionDto[];

  @Expose()
  @ApiProperty({ example: '2026-07-08T10:00:00.000Z' })
  generatedAt: string;
}
