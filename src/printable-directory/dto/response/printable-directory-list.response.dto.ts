import { ApiProperty } from '@nestjs/swagger';
import { PaginationResponseDto } from 'src/common/dto/pagination-response.dto';
import { PrintableDirectoryResponseDto } from './printable-directory.response.dto';

export class PrintableDirectoryListResponseDto extends PaginationResponseDto {
  @ApiProperty({ type: [PrintableDirectoryResponseDto] })
  items: PrintableDirectoryResponseDto[];
}
