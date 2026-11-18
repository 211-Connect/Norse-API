import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  TenantAppConfig,
  TenantAppConfigAlert,
  TenantAppConfigTheme,
} from '../types';

export class TenantAppConfigThemeDto implements TenantAppConfigTheme {
  @ApiPropertyOptional({ example: '#005191' })
  primaryColor?: string;

  @ApiPropertyOptional({ example: '#FFB351' })
  secondaryColor?: string;

  @ApiPropertyOptional({ example: '6px' })
  borderRadius?: string;
}

export class TenantAppConfigBrandDto {
  @ApiProperty({ type: TenantAppConfigThemeDto })
  theme: TenantAppConfigThemeDto;
}

export class TenantAppConfigMapDto {
  @ApiProperty({
    type: [Number],
    nullable: true,
    minItems: 2,
    maxItems: 2,
    description:
      "The map's starting center as [longitude, latitude], or null when Payload has none. A center Payload holds latitude first is swapped when its order is certain (second value outside ±90)",
    example: [-122.3321, 47.6062],
  })
  center: [number, number] | null;

  @ApiPropertyOptional({ example: 10 })
  zoom?: number;
}

export class TenantAppConfigSearchDto {
  @ApiProperty({ type: TenantAppConfigMapDto })
  map: TenantAppConfigMapDto;

  @ApiPropertyOptional({
    description: 'Default search radius in miles',
    example: 25,
  })
  defaultRadius?: number;
}

export class TenantAppConfigAlertDto implements TenantAppConfigAlert {
  @ApiProperty()
  text: string;

  @ApiPropertyOptional()
  buttonText?: string;

  @ApiPropertyOptional()
  url?: string;

  @ApiPropertyOptional({ example: '_blank' })
  target?: string;

  @ApiPropertyOptional({ example: 'default' })
  variant?: string;
}

export class TenantAppConfigResponseDto implements TenantAppConfig {
  @ApiProperty()
  tenantId: string;

  @ApiProperty({ type: TenantAppConfigBrandDto })
  brand: TenantAppConfigBrandDto;

  @ApiProperty({ type: TenantAppConfigSearchDto })
  search: TenantAppConfigSearchDto;

  @ApiProperty({
    type: [TenantAppConfigAlertDto],
    description: 'Alerts that are active now; empty when there are none',
  })
  alerts: TenantAppConfigAlertDto[];
}
