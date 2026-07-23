import {
  ApiPropertyOptional,
  IntersectionType,
  PartialType,
} from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  PRINTABLE_DIRECTORY_COVER_LAYOUTS,
  PrintableDirectoryCoverLayout,
} from 'src/common/schemas/printable-directory.schema';
import { PrintableDirectoryDescriptionLocalizedApiDto } from '../common/description-localized.api-dto';
import { PrintableDirectoryTitleLocalizedApiDto } from '../common/title-localized.api-dto';

export class PrintableDirectoryCoverDto extends IntersectionType(
  PartialType(PrintableDirectoryTitleLocalizedApiDto),
  PartialType(PrintableDirectoryDescriptionLocalizedApiDto),
) {
  @ApiPropertyOptional({ example: '#0f172a' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  primaryColor?: string;

  @ApiPropertyOptional({ enum: PRINTABLE_DIRECTORY_COVER_LAYOUTS })
  @IsOptional()
  @IsEnum(PRINTABLE_DIRECTORY_COVER_LAYOUTS)
  layoutType?: PrintableDirectoryCoverLayout;

  @ApiPropertyOptional({ example: 'https://example.com/cover-front.jpg' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  coverImageUrlFront?: string;

  @ApiPropertyOptional({ example: 'https://example.com/cover-back.jpg' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  coverImageUrlBack?: string;
}
