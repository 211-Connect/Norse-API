import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';

export class TenantConfigQueryDto {
  @ApiProperty({
    required: false,
    default: 'en',
    example: 'en',
    description:
      'Locale of `appConfig`. Falls back to `en` when the tenant has no app config in this locale. The other fields are not affected: they carry every locale.',
  })
  @IsOptional()
  @Matches(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/, {
    message: 'locale must be a locale code such as en or es',
  })
  locale?: string;
}
