import { ApiProperty } from '@nestjs/swagger';
import type { LanguageSwitchDestination } from '../types';

export class LanguageSwitchDestinationsResponse
  implements LanguageSwitchDestination
{
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
