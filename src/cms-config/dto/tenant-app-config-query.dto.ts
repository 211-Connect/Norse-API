import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';

export class TenantAppConfigQueryDto {
  @ApiProperty({
    required: false,
    default: 'en',
    example: 'en',
    description:
      'Locale of the alert and theme texts, as Payload names it (e.g. en, es)',
  })
  @IsOptional()
  @Matches(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/, {
    message: 'locale must be a locale code such as en or es',
  })
  locale?: string;
}
