import { ApiProperty } from '@nestjs/swagger';

export class PrintableDirectoryLocalizedTextResponseDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    example: { en: 'Default copy', es: 'Texto predeterminado' },
  })
  values: Record<string, string>;
}
