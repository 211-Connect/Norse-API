import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class PrintableDirectoryPreviewQueryDto {
  @ApiPropertyOptional({
    description:
      'Locale override for preview rendering (fallback: header accept-language)',
    example: 'en',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  locale?: string;
}
