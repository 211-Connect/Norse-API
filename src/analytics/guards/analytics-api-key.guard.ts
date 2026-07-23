import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

import { AnalyticsConfigService } from '../services/analytics-config.service';

export const ANALYTICS_API_KEY_HEADER = 'x-analytics-api-key';
export const TENANT_ID_HEADER = 'x-tenant-id';

@Injectable()
export class AnalyticsApiKeyGuard implements CanActivate {
  constructor(
    private readonly analyticsConfigService: AnalyticsConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    const tenantId = request.headers[TENANT_ID_HEADER] as string | undefined;
    if (!tenantId) {
      throw new UnauthorizedException(`Missing ${TENANT_ID_HEADER} header`);
    }

    const apiKey = request.headers[ANALYTICS_API_KEY_HEADER] as
      string | undefined;
    if (!apiKey) {
      throw new UnauthorizedException(
        `Missing ${ANALYTICS_API_KEY_HEADER} header`,
      );
    }

    const isValid = await this.analyticsConfigService.validateApiKey(
      tenantId,
      apiKey,
    );
    if (!isValid) {
      throw new UnauthorizedException(
        'Invalid analytics API key for this tenant',
      );
    }

    return true;
  }
}
