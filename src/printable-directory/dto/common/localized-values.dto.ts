import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsObject, IsOptional, IsString } from 'class-validator';

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

  @ApiPropertyOptional({
    description:
      'Locales whose values in `values` were machine-translated and are safe ' +
      'to overwrite with an automatic re-translation. Locales with values but ' +
      'not in this list are treated as human-edited and protected.',
    type: [String],
    example: ['es'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  autoTranslatedLocales?: string[];
}
