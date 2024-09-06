import axios from 'axios';
import { Request } from 'express';
import qs from 'qs';

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
