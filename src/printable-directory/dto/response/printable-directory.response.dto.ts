import { ApiProperty } from '@nestjs/swagger';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PrintableDirectoryDefaultQueryConfigDto } from '../common/printable-directory-default-query-config.dto';
import { PrintableDirectoryCoverResponseDto } from './printable-directory-cover.response.dto';
import { PrintableDirectoryHeaderFooterResponseDto } from './printable-directory-header-footer.response.dto';
import { PrintableDirectorySectionResponseDto } from './printable-directory-section.response.dto';
import {
  PRINTABLE_DIRECTORY_ACCESS_POLICIES,
  PRINTABLE_DIRECTORY_RESOURCE_LAYOUTS,
  PrintableDirectoryAccessPolicy,
  PrintableDirectoryResourceLayout,
} from 'src/common/schemas/printable-directory.schema';

export class PrintableDirectoryResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  tenantId: string;

  @ApiProperty()
  ownerUserId: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  updatedBy?: string | null;

  @ApiProperty({
    enum: PRINTABLE_DIRECTORY_ACCESS_POLICIES,
    description:
      'Access config for tenant users: private (owner read/update), shared-read (others read, only owner updates), shared-edit (others can read and update).',
  })
  accessPolicy: PrintableDirectoryAccessPolicy;

  @ApiProperty({ type: PrintableDirectoryCoverResponseDto })
  cover: PrintableDirectoryCoverResponseDto;

  @ApiProperty({ type: PrintableDirectoryHeaderFooterResponseDto })
  header: PrintableDirectoryHeaderFooterResponseDto;

  @ApiProperty({ type: PrintableDirectoryHeaderFooterResponseDto })
  footer: PrintableDirectoryHeaderFooterResponseDto;

  @ApiProperty({ enum: PRINTABLE_DIRECTORY_RESOURCE_LAYOUTS })
  resourceLayout: PrintableDirectoryResourceLayout;

  @ApiPropertyOptional({
    type: PrintableDirectoryDefaultQueryConfigDto,
    nullable: true,
  })
  defaultQueryConfig?: PrintableDirectoryDefaultQueryConfigDto | null;

  @ApiProperty({ type: [PrintableDirectorySectionResponseDto] })
  sections: PrintableDirectorySectionResponseDto[];

  @ApiProperty({ example: '2026-07-08T08:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-07-08T09:00:00.000Z' })
  updatedAt: string;
}
