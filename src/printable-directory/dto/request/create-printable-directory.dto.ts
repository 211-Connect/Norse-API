import { ApiProperty } from '@nestjs/swagger';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
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
  PrintableDirectoryAccessPolicy,
} from 'src/common/schemas/printable-directory.schema';
import { PrintableDirectoryDefaultQueryConfigDto } from '../common/printable-directory-default-query-config.dto';

export class CreatePrintableDirectoryDto {
  @ApiProperty({ example: 'My Printable Directory' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiProperty({
    example: 'en',
    description:
      'Locale code for the language the directory content was authored in. ' +
      'Required at creation and immutable after creation.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  primaryLanguage: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['en', 'es'],
    description:
      'Locale codes the directory is offered in (translated, printed and ' +
      'shared in). primaryLanguage is always included, even if omitted. ' +
      'Defaults to [primaryLanguage] at creation.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(10, { each: true })
  locales?: string[];

  @ApiPropertyOptional({
    example: 'https://example.com/logo.svg',
    description:
      "The directory's logo, printed wherever the header or footer layout " +
      "includes `logo`. Empty to clear (the tenant's logo is used then).",
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  logoUrl?: string;

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

  @ApiPropertyOptional({
    type: PrintableDirectoryDefaultQueryConfigDto,
    nullable: true,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PrintableDirectoryDefaultQueryConfigDto)
  defaultQueryConfig?: PrintableDirectoryDefaultQueryConfigDto | null;
}
