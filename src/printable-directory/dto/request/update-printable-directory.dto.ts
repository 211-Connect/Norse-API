import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, ValidateNested } from 'class-validator';
import { CreatePrintableDirectoryDto } from './create-printable-directory.dto';
import { PrintableDirectoryCoverDto } from './printable-directory-cover.dto';
import { PrintableDirectoryHeaderFooterDto } from './printable-directory-header-footer.dto';

export class UpdatePrintableDirectoryDto extends PartialType(
  CreatePrintableDirectoryDto,
) {
  @ApiPropertyOptional({ type: PrintableDirectoryCoverDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PrintableDirectoryCoverDto)
  cover?: PrintableDirectoryCoverDto;

  @ApiPropertyOptional({ type: PrintableDirectoryHeaderFooterDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PrintableDirectoryHeaderFooterDto)
  header?: PrintableDirectoryHeaderFooterDto;

  @ApiPropertyOptional({ type: PrintableDirectoryHeaderFooterDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PrintableDirectoryHeaderFooterDto)
  footer?: PrintableDirectoryHeaderFooterDto;
}
