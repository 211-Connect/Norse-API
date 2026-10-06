import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Inject,
  Logger,
  Optional,
} from '@nestjs/common';
import { ARCJET, ArcjetNest } from '@arcjet/nest';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class ArcjetGuard implements CanActivate {
  private readonly logger = new Logger(ArcjetGuard.name);

  constructor(
    @Optional()
    @Inject(ARCJET)
    private readonly arcjet: ArcjetNest | undefined,
    @Optional()
    private readonly configService: ConfigService | undefined,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    const arcjetKey =
      this.configService?.get<string>('ARCJET_KEY') ?? process.env.ARCJET_KEY;

    if (!arcjetKey) {
      return true;
    }

    if (!this.arcjet) {
      this.logger.error({
        event: 'arcjet_missing_client',
        message:
          'ARCJET_KEY is configured but the Arcjet client is not available',
      });
      return true;
    }

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

    if (decision.isErrored()) {
      this.logger.error({
        event: 'arcjet_error',
        reason: decision.reason,
        ip: decision.ip,
        tenantId: req.headers['x-tenant-id'],
        pathName: req.url,
      });
    }

    return true;
  }
}
