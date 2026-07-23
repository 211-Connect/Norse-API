import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  PRINTABLE_DIRECTORY_SOURCE_TYPES,
  PrintableDirectorySourceType,
} from 'src/common/schemas/printable-directory.schema';
import { PrintableDirectorySourceQueryDto } from './printable-directory-source-query.dto';

export class PrintableDirectorySectionSourceDto {
  @ApiProperty({ enum: PRINTABLE_DIRECTORY_SOURCE_TYPES })
  @IsEnum(PRINTABLE_DIRECTORY_SOURCE_TYPES)
  type: PrintableDirectorySourceType;

  @ApiPropertyOptional({ type: PrintableDirectorySourceQueryDto })
  @ValidateIf((dto: PrintableDirectorySectionSourceDto) => dto.type === 'query')
  @ValidateNested()
  @Type(() => PrintableDirectorySourceQueryDto)
  query?: PrintableDirectorySourceQueryDto;

  @ApiPropertyOptional({ example: 'favorites-list-id' })
  @ValidateIf(
    (dto: PrintableDirectorySectionSourceDto) => dto.type === 'favorites_list',
  )
  @IsString()
  @IsNotEmpty()
  favoritesListId?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['resource-a', 'resource-b'],
  })
  @ValidateIf(
    (dto: PrintableDirectorySectionSourceDto) => dto.type === 'resource_ids',
  )
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  resourceIds?: string[];
}
