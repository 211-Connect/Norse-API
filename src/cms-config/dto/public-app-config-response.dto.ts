import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PublicAppConfigAlert,
  PublicAppConfigCache,
  PublicAppConfigLegalPage,
  PublicAppConfigMenuItem,
} from '../types';

export class PublicAppConfigThemeDto {
  @ApiPropertyOptional({ example: '#005191' })
  primaryColor?: string;

  @ApiPropertyOptional({ example: '#FFB351' })
  secondaryColor?: string;

  @ApiPropertyOptional({ example: '6px' })
  borderRadius?: string;
}

export class PublicAppConfigBrandDto {
  @ApiProperty({ example: 'Wyoming 211' })
  name: string;

  @ApiPropertyOptional()
  logoUrl?: string;

  @ApiPropertyOptional()
  faviconUrl?: string;

  @ApiPropertyOptional()
  openGraphUrl?: string;

  @ApiProperty({ type: PublicAppConfigThemeDto })
  theme: PublicAppConfigThemeDto;
}

export class PublicAppConfigMetaDto {
  @ApiProperty()
  title: string;

  @ApiProperty()
  description: string;
}

export class PublicAppConfigContactDto {
  @ApiPropertyOptional({ example: '211' })
  number?: string;
}

export class PublicAppConfigMenuItemDto implements PublicAppConfigMenuItem {
  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  href?: string;

  @ApiPropertyOptional()
  openInNewTab?: boolean;
}

export class PublicAppConfigHeaderDto {
  @ApiPropertyOptional()
  customHomeUrl?: string;

  @ApiProperty({ type: [PublicAppConfigMenuItemDto] })
  customMenu: PublicAppConfigMenuItemDto[];

  @ApiPropertyOptional()
  feedbackUrl?: string;
}

export class PublicAppConfigFooterDto {
  @ApiProperty({ type: [PublicAppConfigMenuItemDto] })
  customMenu: PublicAppConfigMenuItemDto[];

  @ApiPropertyOptional()
  copyright?: string;

  @ApiPropertyOptional()
  disclaimer?: string;
}

export class PublicAppConfigLegalPageDto implements PublicAppConfigLegalPage {
  @ApiProperty()
  enabled: boolean;

  @ApiPropertyOptional()
  title?: string;
}

export class PublicAppConfigPagesDto {
  @ApiProperty({ type: PublicAppConfigLegalPageDto })
  accessibilityPage: PublicAppConfigLegalPageDto;

  @ApiProperty({ type: PublicAppConfigLegalPageDto })
  privacyPolicyPage: PublicAppConfigLegalPageDto;

  @ApiProperty({ type: PublicAppConfigLegalPageDto })
  termsOfUsePage: PublicAppConfigLegalPageDto;
}

export class PublicAppConfigAlertDto implements PublicAppConfigAlert {
  @ApiProperty()
  text: string;

  @ApiPropertyOptional()
  buttonText?: string;

  @ApiPropertyOptional()
  url?: string;

  @ApiPropertyOptional({ enum: ['_self', '_blank'] })
  target?: '_self' | '_blank';

  @ApiPropertyOptional({ enum: ['destructive', 'default'] })
  variant?: 'destructive' | 'default';
}

export class PublicAppConfigI18nDto {
  @ApiProperty({ example: 'en' })
  defaultLocale: string;

  @ApiProperty({ type: [String], example: ['en', 'es'] })
  locales: string[];
}

export class PublicAppConfigNewLayoutDto {
  @ApiPropertyOptional()
  enabled?: boolean;

  @ApiPropertyOptional()
  headerStart?: string;

  @ApiPropertyOptional()
  headerEnd?: string;
}

export class PublicAppConfigMapDto {
  @ApiProperty({
    type: [Number],
    minItems: 2,
    maxItems: 2,
    description: "The map's starting center as [longitude, latitude]",
    example: [-107.290283, 43.07597],
  })
  center: [number, number];

  @ApiProperty({ example: 7 })
  zoom: number;
}

export class PublicAppConfigSearchDto {
  @ApiProperty({ type: PublicAppConfigMapDto })
  map: PublicAppConfigMapDto;

  @ApiPropertyOptional({
    description: 'Default search radius in miles',
    example: 25,
  })
  defaultRadius?: number;
}

export class PublicAppConfigResponseDto implements PublicAppConfigCache {
  @ApiProperty()
  tenantId: string;

  @ApiProperty({ example: 'en', description: 'Locale of the texts below' })
  locale: string;

  @ApiProperty({ type: PublicAppConfigBrandDto })
  brand: PublicAppConfigBrandDto;

  @ApiProperty({ type: PublicAppConfigMetaDto })
  meta: PublicAppConfigMetaDto;

  @ApiProperty({ type: PublicAppConfigContactDto })
  contact: PublicAppConfigContactDto;

  @ApiProperty({ type: PublicAppConfigHeaderDto })
  header: PublicAppConfigHeaderDto;

  @ApiProperty({ type: PublicAppConfigFooterDto })
  footer: PublicAppConfigFooterDto;

  @ApiProperty({ type: PublicAppConfigPagesDto })
  pages: PublicAppConfigPagesDto;

  @ApiPropertyOptional()
  heroUrl?: string;

  @ApiProperty({
    type: [PublicAppConfigAlertDto],
    description: 'Active alerts; empty when there are none',
  })
  alerts: PublicAppConfigAlertDto[];

  @ApiProperty({ type: PublicAppConfigI18nDto })
  i18n: PublicAppConfigI18nDto;

  @ApiPropertyOptional({ type: PublicAppConfigNewLayoutDto })
  newLayout?: PublicAppConfigNewLayoutDto;

  @ApiProperty({ type: PublicAppConfigSearchDto })
  search: PublicAppConfigSearchDto;
}
