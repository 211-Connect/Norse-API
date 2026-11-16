import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Feature flag for `/v2/search`: on only for the exact string `true`. Off, the
 * route looks absent (404). A guard runs before the validation pipe, so a
 * disabled route never answers 400 for a bad query.
 */
@Injectable()
export class V2SearchEnabledGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(): boolean {
    if (this.configService.get('V2_SEARCH_ENABLED') !== 'true') {
      throw new NotFoundException();
    }
    return true;
  }
}
