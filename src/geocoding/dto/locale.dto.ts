import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class LocaleDto {
  @ApiProperty({
    description: 'Language locale for the response',
    example: 'en',
    default: 'en',
  })
  @IsString()
  locale?: string = 'en';
}
