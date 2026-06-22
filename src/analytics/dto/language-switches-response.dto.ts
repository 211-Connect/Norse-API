import { ApiProperty } from '@nestjs/swagger';
import type { LanguageSwitch } from '../types';

export class LanguageSwitchesResponse implements LanguageSwitch {
  @ApiProperty({
    description: 'Destination language code the user switched to',
    example: 'fr',
  })
  language: string;

  @ApiProperty({
    description: 'Number of times users switched to this language',
    example: 45,
  })
  count: number;
}
