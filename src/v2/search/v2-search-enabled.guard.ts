import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { envFlag } from '../../common/config/configuration';

/**
 * One switch for `/v2/search`: the env `V2_SEARCH_ENABLED`, on only for the
 * exact string `true` (any case). Off, the route looks absent (404). A guard
 * runs before the validation pipe, so a disabled route never answers 400 for a
 * bad query.
 *
 * There is no per-tenant check. The Payload flag `enableV2Api` chooses which
 * search Norse's own pages use; it does not decide who may call the API. Which
 * tenants a caller may search is the gateway's job: each key carries
 * `norse-api.<tenant>.read` scopes.
 */
@Injectable()
export class V2SearchEnabledGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(): boolean {
    if (!envFlag(this.configService.get<string>('V2_SEARCH_ENABLED'), false)) {
      throw new NotFoundException();
    }
    return true;
  }
}
