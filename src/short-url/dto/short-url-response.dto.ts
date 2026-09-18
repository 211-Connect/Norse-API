import { ApiProperty } from '@nestjs/swagger';
import { ShortUrlResponse } from '../types/short-url-response.types';

export class ShortUrlResponseDto implements ShortUrlResponse {
  @ApiProperty({
    description:
      'For `GET /short-url/:id`, the original URL the short ID resolves to. ' +
      'For `POST /short-url`, the fully-qualified short URL that was found or created.',
    example: 'https://example.org/share/aBcD1234EfGh',
  })
  url: string;
}
