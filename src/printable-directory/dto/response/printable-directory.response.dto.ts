import { ApiProperty } from '@nestjs/swagger';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PrintableDirectoryDefaultQueryConfigDto } from '../common/printable-directory-default-query-config.dto';
import { PrintableDirectoryCoverResponseDto } from './printable-directory-cover.response.dto';
import { PrintableDirectoryHeaderFooterResponseDto } from './printable-directory-header-footer.response.dto';
import { PrintableDirectorySectionResponseDto } from './printable-directory-section.response.dto';
import {
  PRINTABLE_DIRECTORY_ACCESS_POLICIES,
  PrintableDirectoryAccessPolicy,
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

  @ApiProperty({
    example: 'en',
    description:
      'Locale code for the language the directory content was authored in. ' +
      'Immutable after creation.',
  })
  primaryLanguage: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  updatedBy?: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "The directory's logo for the header/footer; null when the tenant's " +
      'logo is used.',
  })
  logoUrl: string | null;

  @ApiProperty({
    enum: PRINTABLE_DIRECTORY_ACCESS_POLICIES,
    description:
      'Access config for tenant users: private (owner read/update), shared-read (others read, only owner updates), shared-edit (others can read and update).',
  })
  accessPolicy: PrintableDirectoryAccessPolicy;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'winter-shelter-guide',
    description:
      'Public, tenant-unique slug used for fully public preview sharing. Null if not set.',
  })
  slug?: string | null;

  @ApiProperty({ type: PrintableDirectoryCoverResponseDto })
  cover: PrintableDirectoryCoverResponseDto;

  @ApiProperty({ type: PrintableDirectoryHeaderFooterResponseDto })
  header: PrintableDirectoryHeaderFooterResponseDto;

  @ApiProperty({ type: PrintableDirectoryHeaderFooterResponseDto })
  footer: PrintableDirectoryHeaderFooterResponseDto;

  @ApiPropertyOptional({
    type: PrintableDirectoryDefaultQueryConfigDto,
    nullable: true,
  })
  defaultQueryConfig?: PrintableDirectoryDefaultQueryConfigDto | null;

  @ApiProperty({ type: [PrintableDirectorySectionResponseDto] })
  sections: PrintableDirectorySectionResponseDto[];

  @ApiProperty({
    description:
      'Locales the directory is offered in, primaryLanguage always included. ' +
      'Set via create/update `locales`. For directories created before ' +
      'locales were stored, derived from the locales that have content.',
    type: [String],
    example: ['en', 'es'],
  })
  locales: string[];

  @ApiProperty({ example: '2026-07-08T08:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-07-08T09:00:00.000Z' })
  updatedAt: string;
}
