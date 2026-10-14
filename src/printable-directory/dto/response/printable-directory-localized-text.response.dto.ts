import { ApiProperty } from '@nestjs/swagger';

export class PrintableDirectoryLocalizedTextResponseDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    example: { en: 'Default copy', es: 'Texto predeterminado' },
  })
  values: Record<string, string>;

  @ApiProperty({
    description:
      'Locales whose values were machine-translated and are safe to overwrite ' +
      'with an automatic re-translation. Locales with values but not in this ' +
      'list are treated as human-edited and protected.',
    type: [String],
    example: ['es'],
  })
  autoTranslatedLocales: string[];
}
