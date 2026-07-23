import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PRINTABLE_DIRECTORY_SOURCE_TYPES,
  PrintableDirectorySourceType,
} from 'src/common/schemas/printable-directory.schema';
import { PrintableDirectorySourceQueryResponseDto } from './printable-directory-source-query.response.dto';

export class PrintableDirectorySourceSummaryResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  count: number;
}

export class PrintableDirectorySourceResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  order: number;

  @ApiProperty({ enum: PRINTABLE_DIRECTORY_SOURCE_TYPES })
  type: PrintableDirectorySourceType;

  @ApiPropertyOptional({
    type: PrintableDirectorySourceQueryResponseDto,
    nullable: true,
  })
  query?: PrintableDirectorySourceQueryResponseDto | null;

  @ApiPropertyOptional({
    type: PrintableDirectorySourceSummaryResponseDto,
    nullable: true,
  })
  favoriteList?: PrintableDirectorySourceSummaryResponseDto | null;

  @ApiProperty({ type: [PrintableDirectorySourceSummaryResponseDto] })
  resources?: PrintableDirectorySourceSummaryResponseDto[];
}
