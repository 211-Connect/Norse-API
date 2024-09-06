import {
  BadRequestException,
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';
import axios from 'axios';
import { Request } from 'express';
import qs from 'qs';
import { xTenantIdSchema } from '../dto/headers.dto';

export const Tenant = createParamDecorator(
  async (data: any, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<Request>();

    let tenantHeader;
    try {
      tenantHeader = await xTenantIdSchema.parseAsync(
        req.headers['x-tenant-id'],
      );
    } catch (err) {
      throw new BadRequestException();
    }

    const cachedData = await req.cacheService.get(`tenant:${tenantHeader}`);

    if (cachedData) return cachedData;

    try {
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
        `${req.configService.get('STRAPI_URL')}/api/tenants?filters[tenantId][$eq]=${tenantHeader}&${strapiPopulateQuery}`,
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

      await req.cacheService.set(`tenant:${tenantHeader}`, tenantData, 0);

      return tenantData;
    } catch (err) {
      throw new BadRequestException();
    }
  },
);
