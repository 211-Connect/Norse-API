import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * The one switch for `/v2/search`, for the whole deployment: env
 * `V2_SEARCH_ENABLED`, on only for the exact string `true` (stricter than
 * `envFlag`). Anything else makes the route look absent (404). A guard runs
 * before the validation pipe, so a disabled route never answers 400 for a bad
 * query.
 *
 * There is no tenant check here. Which tenants a gateway key may search is the
 * key's scope (`TenantScopeGuard`). As on v1, a request without the gateway
 * identity headers has no tenant scope.
 */
@Injectable()
export class V2SearchEnabledGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(): boolean {
    if (this.configService.get<string>('V2_SEARCH_ENABLED') !== 'true') {
      throw new NotFoundException();
    }
    return true;
  }
}
