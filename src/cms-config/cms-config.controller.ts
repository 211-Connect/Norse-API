import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  HttpCode,
  UseGuards,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { OrchestrationConfigService } from './orchestration-config.service';
import { TenantConfigService } from './tenant-config.service';
import { InternalApiGuard } from '../common/guards/internal-api.guard';
import {
  ApiTags,
  ApiResponse,
  ApiSecurity,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { TenantBrandingConfig, TenantLegalConfig } from './types';

@ApiTags('CMS Config')
@Controller('cms-config')
@UseGuards(InternalApiGuard)
@ApiSecurity('x-internal-api-key')
export class CmsConfigController {
  constructor(
    private readonly orchestrationConfigService: OrchestrationConfigService,
    private readonly tenantConfigService: TenantConfigService,
  ) {}

  @Post('cache/clear')
  @HttpCode(204)
  @ApiResponse({
    status: 204,
    description: 'All in-memory caches cleared successfully',
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid or missing internal API key',
  })
  async clearAllCaches(): Promise<void> {
    this.orchestrationConfigService.clearCache();
    this.tenantConfigService.clearCache();
  }

  @Post('cache/clear/:tenantId')
  @HttpCode(204)
  @ApiParam({
    name: 'tenantId',
    description: 'Tenant ID to clear cache for',
    example: 'tenant123',
  })
  @ApiResponse({
    status: 204,
    description: 'In-memory cache cleared for the specified tenant',
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid or missing internal API key',
  })
  async clearTenantCache(@Param('tenantId') tenantId: string): Promise<void> {
    this.orchestrationConfigService.clearCacheForTenant(tenantId);
    this.tenantConfigService.clearCacheForTenant(tenantId);
  }

  @Get('branding/:tenantId')
  @ApiParam({
    name: 'tenantId',
    required: true,
    description: 'Tenant ID to fetch branding configuration for',
    example: 'tenant123',
  })
  @ApiQuery({
    name: 'locale',
    required: true,
    description:
      'Locale to fetch branding for (must be an enabled locale for the tenant)',
    example: 'en',
  })
  @ApiResponse({
    status: 200,
    description: 'Tenant branding configuration',
    schema: {
      type: 'object',
      properties: {
        tenantId: { type: 'string', example: 'tenant123' },
        locale: { type: 'string', example: 'en' },
        revision: { type: 'string', example: '2026-05-15T17:20:11.000Z' },
        resolvedFrom: {
          type: 'object',
          properties: {
            source: { type: 'string', example: 'payload' },
            resourceDirectoryId: { type: 'string', example: 'abc123' },
          },
        },
        brand: {
          type: 'object',
          properties: {
            name: { type: 'string', example: 'Connect211' },
            logoUrl: {
              type: 'string',
              example: 'https://cdn.example.com/logo.svg',
            },
            heroUrl: {
              type: 'string',
              example: 'https://cdn.example.com/hero.png',
            },
            newLayoutLogoUrl: {
              type: 'string',
              example: 'https://cdn.example.com/logo-new.svg',
            },
            newLayoutHeroUrl: {
              type: 'string',
              example: 'https://cdn.example.com/hero-new.png',
            },
            faviconUrl: {
              type: 'string',
              example: 'https://cdn.example.com/favicon.png',
            },
            openGraphUrl: {
              type: 'string',
              example: 'https://cdn.example.com/og.png',
            },
            copyright: { type: 'string', example: '© 2026 Connect211' },
          },
        },
        theme: {
          type: 'object',
          properties: {
            newLayoutEnabled: { type: 'boolean', example: false },
            primaryColor: { type: 'string', example: '#005191' },
            secondaryColor: { type: 'string', example: '#FFB351' },
            borderRadius: { type: 'string', example: '6px' },
            headerGradient: {
              type: 'object',
              properties: {
                start: { type: 'string', example: '#ffffff' },
                end: { type: 'string', example: '#ffffff' },
              },
            },
          },
        },
        metadata: {
          type: 'object',
          properties: {
            title: { type: 'string', example: 'Connect211' },
            description: {
              type: 'string',
              example: 'Local help and resources',
            },
          },
        },
        contact: {
          type: 'object',
          properties: {
            phoneNumber: { type: 'string', example: '2-1-1' },
            feedbackUrl: {
              type: 'string',
              example: 'https://example.211.org/feedback',
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Missing or invalid locale query parameter',
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid or missing internal API key',
  })
  @ApiResponse({
    status: 404,
    description: 'Branding config not found for the given tenant and locale',
  })
  async getTenantBranding(
    @Param('tenantId') tenantId: string,
    @Query('locale') locale: string,
  ): Promise<TenantBrandingConfig> {
    if (!locale) {
      throw new BadRequestException('locale query parameter is required');
    }

    const branding = await this.tenantConfigService.getBrandingConfig(
      tenantId,
      locale,
    );

    if (!branding) {
      throw new NotFoundException(
        `Branding config not found for tenant ${tenantId} and locale ${locale}`,
      );
    }

    return branding;
  }

  @Get('legal/:tenantId')
  @ApiParam({
    name: 'tenantId',
    required: true,
    description: 'Tenant ID to fetch legal configuration for',
    example: 'tenant123',
  })
  @ApiQuery({
    name: 'locale',
    required: true,
    description:
      'Locale to fetch legal content for (must be an enabled locale for the tenant)',
    example: 'en',
  })
  @ApiResponse({
    status: 200,
    description: 'Tenant legal page configuration',
    schema: {
      type: 'object',
      properties: {
        tenantId: { type: 'string', example: 'tenant123' },
        locale: { type: 'string', example: 'en' },
        revision: { type: 'string', example: '2026-05-15T17:20:11.000Z' },
        resolvedFrom: {
          type: 'object',
          properties: {
            source: { type: 'string', example: 'payload' },
            resourceDirectoryId: { type: 'string', example: 'abc123' },
          },
        },
        privacyPolicy: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean', example: true },
            title: { type: 'string', example: 'Privacy Policy' },
            content: { type: 'string', example: 'We respect your privacy...' },
          },
        },
        termsOfUse: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean', example: true },
            title: { type: 'string', example: 'Terms of Use' },
            content: { type: 'string', example: 'By using this service...' },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Missing or invalid locale query parameter',
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid or missing internal API key',
  })
  @ApiResponse({
    status: 404,
    description: 'Legal config not found for the given tenant and locale',
  })
  async getTenantLegal(
    @Param('tenantId') tenantId: string,
    @Query('locale') locale: string,
  ): Promise<TenantLegalConfig> {
    if (!locale) {
      throw new BadRequestException('locale query parameter is required');
    }

    const legal = await this.tenantConfigService.getLegalConfig(
      tenantId,
      locale,
    );

    if (!legal) {
      throw new NotFoundException(
        `Legal config not found for tenant ${tenantId} and locale ${locale}`,
      );
    }

    return legal;
  }
}
