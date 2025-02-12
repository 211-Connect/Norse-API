import axios from 'axios';
import { Request } from 'express';
import qs from 'qs';
import jwt from 'jsonwebtoken';
import jwkToBuffer from 'jwk-to-pem';
import { HeadersDto } from 'src/common/dto/headers.dto';

export async function fetchTenantById(
  id: string,
  { req }: { req: Request },
): Promise<Request['tenant']> {
  const cachedData = await req.cacheService.get<Request['tenant']>(
    `tenant:${id}`,
  );

  if (cachedData) return cachedData;

  const strapiPopulateQuery = qs.stringify({
    populate: {
      facets: {
        populate: '*',
      },
      app_config: {
        populate: 'keycloakConfig',
      },
    },
  });

  const res = await axios.get(
    `${req.configService.get('STRAPI_URL')}/api/tenants?filters[tenantId][$eq]=${id}&${strapiPopulateQuery}`,
    {
      headers: {
        Authorization: `Bearer ${req.configService.get('STRAPI_TOKEN')}`,
      },
    },
  );

  const initialData = res?.data?.data?.[0]?.attributes;

  if (!initialData) {
    throw 'Tenant data not found in Strapi';
  }

  const { app_config, ...rest } = initialData;
  const appConfig = app_config?.data?.attributes;

  if (!initialData) {
    throw 'AppConfig data not found in Strapi';
  }

  const tenantData = {
    ...rest,
    appConfig,
  };

  await req.cacheService.set(`tenant:${id}`, tenantData, 0);

  return tenantData;
}

export async function isAuthorized(request: Request) {
  const configService = request.configService;
  const cacheService = request.cacheService;

  const authHeader = request.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }

  const { tenant } = request;

  if (!tenant) return false;

  let certs: any = await cacheService.get(`keycloak:${tenant.keycloakRealmId}`);

  if (!certs || Object.keys(certs).length === 0) {
    const res = await axios.get(
      `${configService.get('KEYCLOAK_URL')}/realms/${tenant.keycloakRealmId}/protocol/openid-connect/certs`,
    );

    if (!res) {
      return false;
    } else {
      certs = res.data;
      await cacheService.set(`keycloak:${tenant.keycloakRealmId}`, res.data, 0);
    }
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return false;
  }

  const decoded = jwt.decode(token, { complete: true });
  if (!decoded) {
    return false;
  }

  const key = certs.keys.find((el: any) => el.kid === decoded?.header.kid);
  if (!key) return false;

  const pem = jwkToBuffer(key);
  if (!pem) return false;

  const verified = await verify(token, pem);
  if (!verified) return false;

  request.user = {
    id: verified.sub as string,
  };

  return true;
}

async function verify(
  token: string,
  pem: jwt.Secret,
): Promise<string | jwt.JwtPayload | null> {
  try {
    const verified = jwt.verify(token, pem);
    return verified;
  } catch (err) {
    console.error(err);
    return null;
  }
}

// Function to construct Elasticsearch index name
export function getIndexName(headers: HeadersDto, index: string): string {
  const language = headers['accept-language'] ?? undefined;
  const tenantId = headers['x-tenant-id'] ?? undefined;

  let sanitizedLanguage = language;

  if (language && language.includes('-')) {
    sanitizedLanguage = language
      .split('-')
      .map((part, index) =>
        index === 0 ? part.toLowerCase() : part.toLowerCase(),
      )
      .join('_');
  }

  const indexName = `${tenantId}-${index}_${sanitizedLanguage}`;
  return indexName;
}
