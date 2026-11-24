jest.mock('@arcjet/nest', () => ({ ARCJET: 'ARCJET' }));

import {
  CDN_CACHE_TTL_KEY,
  CDN_REQUIRES_URL_MIRRORS_KEY,
} from './cdn-cache-control.interceptor';
import { SearchController } from '../../search/search.controller';
import { OrganizationController } from '../../organization/organization.controller';
import { ResourceController } from '../../resource/resource.controller';
import { ServiceController } from '../../service/service.controller';

describe('@RequireCdnUrlMirrors on v1 cached routes', () => {
  const handlers: [string, { prototype: object }, string][] = [
    ['GET /search', SearchController, 'getResources'],
    ['GET /search/pins', SearchController, 'getPins'],
    ['GET /search/predict', SearchController, 'predictNeedsClassification'],
    ['GET /search/re-rank', SearchController, 'reRankNeedsClassification'],
    [
      'org by service-at-location',
      OrganizationController,
      'getOrganizationByServiceAtLocation',
    ],
    ['org by id', OrganizationController, 'getOrganizationById'],
    ['resource by id', ResourceController, 'getResourceById'],
    ['resource by original id', ResourceController, 'getResourceByOriginalId'],
    ['resources batch', ResourceController, 'getResourcesBatch'],
    ['service by id', ServiceController, 'getServiceById'],
  ];

  it.each(handlers)('%s requires URL mirrors', (_n, controller, method) => {
    const handler = (controller.prototype as Record<string, unknown>)[method];
    expect(handler).toBeDefined();
    expect(
      Reflect.getMetadata(CDN_REQUIRES_URL_MIRRORS_KEY, handler as object),
    ).toBe(true);
  });

  // A new cached route on a tenant-dependent controller must carry the flag
  // too; this fails when someone adds @SetCdnCacheTTL without it.
  it.each([
    ['SearchController', SearchController],
    ['OrganizationController', OrganizationController],
    ['ResourceController', ResourceController],
    ['ServiceController', ServiceController],
  ])('every cached handler on %s requires URL mirrors', (_n, controller) => {
    const proto = controller.prototype as unknown as Record<string, unknown>;
    const cached = Object.getOwnPropertyNames(proto).filter(
      (name) =>
        name !== 'constructor' &&
        typeof proto[name] === 'function' &&
        Reflect.getMetadata(CDN_CACHE_TTL_KEY, proto[name] as object) !==
          undefined,
    );
    expect(cached.length).toBeGreaterThan(0);
    for (const name of cached) {
      expect([
        name,
        Reflect.getMetadata(
          CDN_REQUIRES_URL_MIRRORS_KEY,
          proto[name] as object,
        ),
      ]).toEqual([name, true]);
    }
  });
});
