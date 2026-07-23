import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import {
  PRINTABLE_DIRECTORY_SOURCE_TYPES,
  PrintableDirectorySourceType,
} from 'src/common/schemas/printable-directory.schema';
import { PrintableDirectorySourceQueryDto } from './printable-directory-source-query.dto';

export class UpdatePrintableDirectorySourceDto {
  @ApiPropertyOptional({ enum: PRINTABLE_DIRECTORY_SOURCE_TYPES })
  @IsOptional()
  @IsEnum(PRINTABLE_DIRECTORY_SOURCE_TYPES)
  type?: PrintableDirectorySourceType;

  @ApiPropertyOptional({ type: PrintableDirectorySourceQueryDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PrintableDirectorySourceQueryDto)
  query?: PrintableDirectorySourceQueryDto;

  @ApiPropertyOptional({ example: 'favorites-list-id' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  favoritesListId?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['resource-a', 'resource-b'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  resourceIds?: string[];
}
