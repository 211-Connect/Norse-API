import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { TenantConfigService } from '../../cms-config/tenant-config.service';

/**
 * Two switches for `/v2/search`; both must be on, else the route looks absent
 * (404):
 *  1. global env `V2_SEARCH_ENABLED`, on only for the exact string `true`;
 *  2. per tenant: the Payload flag `enableV2Api` (`isV2Tenant`).
 * A guard runs before the validation pipe, so a disabled route never answers
 * 400 for a bad query. When the URL has no valid `tenant_id` the tenant check
 * is skipped; `V2UrlMirrorsGuard` answers the 400 next.
 */
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
    const tenantId = context.switchToHttp().getRequest<Request>()
      ?.query?.tenant_id;
    if (typeof tenantId === 'string' && tenantId.trim() !== '') {
      if (!(await this.tenantConfig.isV2Tenant(tenantId))) {
        throw new NotFoundException();
      }
    }
    return true;
  }
}
