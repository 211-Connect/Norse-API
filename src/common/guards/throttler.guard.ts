import { Injectable, ExecutionContext } from '@nestjs/common';
import {
  ThrottlerGuard,
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';

@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  constructor(
    options: ThrottlerModuleOptions,
    storageService: ThrottlerStorage,
    reflector: Reflector,
    private configService: ConfigService,
  ) {
    super(options, storageService, reflector);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const internalApiKey = this.configService.get<string>('internalApiKey');

    // Skip rate limiting if internal API key is provided and matches
    // Rate limiting does not apply to Next.js
    const providedApiKey = request.headers['x-api-key'];
    if (internalApiKey && providedApiKey === internalApiKey) {
      return true;
    }

    return super.canActivate(context);
  }
}
