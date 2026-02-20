import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { KeycloakAuthService } from '../services/keycloak-auth.service';

@Injectable()
export class KeycloakGuard implements CanActivate {
  constructor(private readonly keycloakAuthService: KeycloakAuthService) {}

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    return this.keycloakAuthService.isAuthorized(request);
  }
}
