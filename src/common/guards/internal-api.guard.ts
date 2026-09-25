import { createHash, timingSafeEqual } from 'crypto';
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/** Hashing first gives equal-length buffers, so length leaks nothing either. */
const digest = (value: string) => createHash('sha256').update(value).digest();

@Injectable()
export class InternalApiGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const apiKey = request.headers['x-internal-api-key'];
    const expectedApiKey = this.configService.get<string>('internalApiKey');

    if (!expectedApiKey) {
      throw new UnauthorizedException('Internal API key not configured');
    }

    if (
      typeof apiKey !== 'string' ||
      !apiKey ||
      !timingSafeEqual(digest(apiKey), digest(expectedApiKey))
    ) {
      throw new UnauthorizedException('Invalid or missing internal API key');
    }

    return true;
  }
}
