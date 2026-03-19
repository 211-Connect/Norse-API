import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { KeycloakAuthService } from '../services/keycloak-auth.service';

@Injectable()
export class KeycloakGuard implements CanActivate {
  constructor(private readonly keycloakAuthService: KeycloakAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const result = await this.keycloakAuthService.verifyToken(request);

    if (!result.isAuthenticated) {
      throw new UnauthorizedException(
        'Authorization token is missing or invalid.',
      );
    }

    return true;
  }
}
