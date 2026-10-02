import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUrl } from 'class-validator';

export class CreateShortUrlDto {
  @ApiProperty({
    description:
      'The absolute HTTP(S) URL to shorten. An existing short URL is reused if one already exists for this URL.',
    example: 'https://example.org/resource/1',
  })
  @IsString()
  @IsNotEmpty()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  url: string;
}
