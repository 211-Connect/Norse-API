import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional } from 'class-validator';

export class PrintableDirectoryLocalizedValuesDto {
  @ApiPropertyOptional({
    description: 'Localized text map by locale key',
    type: 'object',
    additionalProperties: { type: 'string' },
    example: { en: 'English copy', es: 'Texto en español' },
  })
  @IsOptional()
  @IsObject()
  values?: Record<string, string>;
}
