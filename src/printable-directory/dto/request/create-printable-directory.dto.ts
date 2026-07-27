import { ApiProperty } from '@nestjs/swagger';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  PRINTABLE_DIRECTORY_ACCESS_POLICIES,
  PRINTABLE_DIRECTORY_RESOURCE_LAYOUTS,
  PrintableDirectoryAccessPolicy,
  PrintableDirectoryResourceLayout,
} from 'src/common/schemas/printable-directory.schema';
import { PrintableDirectoryDefaultQueryConfigDto } from '../common/printable-directory-default-query-config.dto';

export class CreatePrintableDirectoryDto {
  @ApiProperty({ example: 'My Printable Directory' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ enum: PRINTABLE_DIRECTORY_ACCESS_POLICIES })
  @IsOptional()
  @IsEnum(PRINTABLE_DIRECTORY_ACCESS_POLICIES)
  accessPolicy?: PrintableDirectoryAccessPolicy;

  @ApiPropertyOptional({
    example: 'winter-shelter-guide',
    description:
      "Public, tenant-unique, URL-safe identifier used to share this directory's " +
      'preview via a fully public link (`GET /printable-directories/public/:slug/preview`). ' +
      'Must be explicitly supplied by the client; it is never auto-generated. ' +
      'The slug acts as a capability token: anyone with the slug can resolve the ' +
      'preview, regardless of accessPolicy, so choose a non-guessable value for ' +
      'directories that should not be publicly discoverable.',
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message:
      'slug must be lowercase kebab-case (letters, numbers, single hyphens between segments)',
  })
  slug?: string;

  @ApiPropertyOptional({ enum: PRINTABLE_DIRECTORY_RESOURCE_LAYOUTS })
  @IsOptional()
  @IsEnum(PRINTABLE_DIRECTORY_RESOURCE_LAYOUTS)
  resourceLayout?: PrintableDirectoryResourceLayout;

  @ApiPropertyOptional({
    type: Boolean,
    default: false,
    description: `Enables booklet layout generation. When enabled, the brochure is formatted for booklet printing by ensuring the total page count is a multiple of four. If necessary, blank pages are inserted after the cover and before the back cover so that the cover remains the first page and the back cover remains the last page.`,
  })
  @IsOptional()
  @IsBoolean()
  isBookletLayout?: boolean;

  @ApiPropertyOptional({
    type: PrintableDirectoryDefaultQueryConfigDto,
    nullable: true,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PrintableDirectoryDefaultQueryConfigDto)
  defaultQueryConfig?: PrintableDirectoryDefaultQueryConfigDto | null;
}
