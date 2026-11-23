import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { TenantConfigService } from '../../cms-config/tenant-config.service';

/**
 * Two switches for `/v2/search`; both must be on, else the route looks absent
 * (404):
 *  1. global env `V2_SEARCH_ENABLED`, on only for the exact string `true`;
 *  2. per tenant: the Payload flag `enableV2Api` (`isV2Tenant`).
 * A guard runs before the validation pipe, so a disabled route never answers
 * 400 for a bad query. When the URL has no valid `tenant_id` the tenant check
 * is skipped; `V2UrlMirrorsGuard` answers the 400 next.
 *
 * When the Redis read of the tenant flag fails, the guard uses the last value
 * this pod read for the tenant and the response carries
 * `X-Degraded: tenant-flag-cache`. A tenant this pod never read gets
 * 503 + `Retry-After: 5`. With Redis up nothing changes.
 */
const RETRY_AFTER_SECONDS = 5;

@Injectable()
export class V2SearchEnabledGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    private readonly tenantConfig: TenantConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.configService.get('V2_SEARCH_ENABLED') !== 'true') {
      throw new NotFoundException();
    }
    const http = context.switchToHttp();
    const tenantId = http.getRequest<Request>()?.query?.tenant_id;
    if (typeof tenantId === 'string' && tenantId.trim() !== '') {
      const flag = await this.tenantConfig.getV2TenantFlag(tenantId);
      const res = http.getResponse<Response>();
      if (flag.unknown) {
        res?.setHeader?.('Retry-After', String(RETRY_AFTER_SECONDS));
        throw new ServiceUnavailableException();
      }
      if (flag.degraded) {
        res?.setHeader?.('X-Degraded', 'tenant-flag-cache');
      }
      if (!flag.enabled) {
        throw new NotFoundException();
      }
    }
    return true;
  }
}
