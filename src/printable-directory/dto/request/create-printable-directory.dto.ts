import { ApiProperty } from '@nestjs/swagger';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  PRINTABLE_DIRECTORY_ACCESS_POLICIES,
  PRINTABLE_DIRECTORY_RESOURCE_LAYOUTS,
  PrintableDirectoryAccessPolicy,
  PrintableDirectoryResourceLayout,
} from 'src/common/schemas/printable-directory.schema';

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

  @ApiPropertyOptional({ enum: PRINTABLE_DIRECTORY_RESOURCE_LAYOUTS })
  @IsOptional()
  @IsEnum(PRINTABLE_DIRECTORY_RESOURCE_LAYOUTS)
  resourceLayout?: PrintableDirectoryResourceLayout;
}
