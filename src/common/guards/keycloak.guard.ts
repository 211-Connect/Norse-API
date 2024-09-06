import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable } from 'rxjs';
import jwt from 'jsonwebtoken';
import jwkToBuffer from 'jwk-to-pem';
import axios from 'axios';
import { fetchTenantById } from '../lib/utils';

@Injectable()
export class KeycloakGuard implements CanActivate {
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    return new Promise(async (resolve) => {
      const request = context.switchToHttp().getRequest<Request>();

      const configService = request.configService;
      const cacheService = request.cacheService;

      const authHeader = request.headers['authorization'];
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return resolve(false);
      }

      const { tenant } = request;

      if (!tenant) return resolve(false);

      const certs = await cacheService.get(
        `keycloak:${tenant.keycloakRealmId}`,
      );

      let response;
      if (Object.keys(certs).length === 0) {
        response = await axios.get(
          `${configService.get('KEYCLOAK_URL')}/realms/${tenant.keycloakRealmId}/protocol/openid-connect/certs`,
        );

        if (
          !(response.data?.keys instanceof Array) ||
          (response.data?.keys instanceof Array &&
            response.data?.keys?.length === 0)
        ) {
          // logger.info('No keys found in response from Keycloak');
          return resolve(false);
        } else {
          await cacheService.set(
            `keycloak:${tenant.keycloakRealmId}`,
            response.data,
            0,
          );
        }
      }

      const token = authHeader.split(' ')[1];
      if (!token) {
        return resolve(false);
      }

      const decoded = jwt.decode(token, { complete: true });
      if (!decoded) {
        return resolve(false);
      }

      const key = response.data.keys.find(
        (el: any) => el.kid === decoded?.header.kid,
      );
      if (!key) return resolve(false);

      const pem = jwkToBuffer(key);
      if (!pem) return resolve(false);

      const verified = await verify(token, pem);
      if (!verified) return resolve(false);

      request.user = {
        id: verified.sub as string,
      };

      resolve(true);
    });
  }
}

async function verify(
  token: string,
  pem: jwt.Secret,
): Promise<string | jwt.JwtPayload | null> {
  try {
    const verified = jwt.verify(token, pem);
    return verified;
  } catch (err) {
    return null;
  }
}
