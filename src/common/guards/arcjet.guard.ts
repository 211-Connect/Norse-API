import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Inject,
  Logger,
} from '@nestjs/common';
import { ARCJET, ArcjetNest } from '@arcjet/nest';
import { Request } from 'express';

@Injectable()
export class ArcjetGuard implements CanActivate {
  private readonly logger = new Logger(ArcjetGuard.name);

  constructor(@Inject(ARCJET) private readonly arcjet: ArcjetNest) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const decision = await this.arcjet.protect(req);

    if (decision.isDenied()) {
      this.logger.warn({
        event: 'arcjet_denied',
        reason: decision.reason,
        ip: decision.ip,
        tenantId: req.headers['x-tenant-id'],
        pathName: req.url,
      });
    }

    return true;
  }
}
