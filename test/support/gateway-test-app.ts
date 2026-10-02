import { Test } from '@nestjs/testing';
import {
  Controller,
  Get,
  INestApplication,
  MiddlewareConsumer,
  Module,
  NestModule,
  Post,
  Provider,
  Req,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { HealthController } from 'src/health/health.controller';
import { HealthService } from 'src/health/health.service';
import { FavoriteListController } from 'src/favorite-list/favorite-list.controller';
import { FavoriteListService } from 'src/favorite-list/favorite-list.service';
import { KeycloakAuthService } from 'src/auth/services/keycloak-auth.service';
import { KeycloakGuard } from 'src/auth/guards/keycloak.guard';
import { TenantMiddleware } from 'src/common/middleware/TenantMiddleware';
import { HttpExceptionFilter } from 'src/common/filters/global-exception.filter';
import { GatewayIdentityGuard } from 'src/auth/gateway/gateway-identity.guard';
import { GatewayPermissionsGuard } from 'src/auth/gateway/gateway-permissions.guard';
import { PermissionsSideChannelService } from 'src/auth/gateway/permissions-side-channel.service';
import { TenantScopeGuard } from 'src/auth/gateway/tenant-scope.guard';

/**
 * Minimal, self-contained test harness standing in for AppModule in e2e
 * specs for the gateway tickets (01-04). The real AppModule cannot be
 * booted under ts-jest today (ArcjetModule ships ESM-only and the test
 * transform isn't configured for it - a pre-existing, unrelated issue), so
 * these specs wire up just enough of the real production pieces
 * (the gateway guards in their real APP_GUARD order, TenantMiddleware,
 * KeycloakGuard + KeycloakAuthService, FavoriteListController) with mocked
 * service/data dependencies to exercise the exact guard/middleware
 * composition and ordering that matters for the gateway tickets, per each
 * ticket's own suggestion to test "against HealthController + one protected
 * controller".
 */

export const OWNER_USER_ID = 'user-1';
export const OTHER_USER_ID = 'user-2';

export const TENANT_A = 'aaaaaaaa-1111-4111-8111-111111111111';
export const TENANT_B = 'bbbbbbbb-2222-4222-8222-222222222222';

const PROBE_ROWS = [
  { id: 'row-a', tenant_id: TENANT_A },
  { id: 'row-b', tenant_id: TENANT_B },
];

/**
 * Stands in for a TenantMiddleware-only route (e.g. TaxonomyController,
 * SearchController) - no Keycloak, so gateway-path assertions here aren't
 * confounded by an unrelated Keycloak 401. Its "rows" simulate a real
 * `WHERE tenant_id = ...`-scoped query so ticket 03's cross-tenant isolation
 * (R3) is actually exercised, not just the guard's own pass/deny decision.
 */
@Controller('probe')
export class TenantProbeController {
  @Get()
  get(@Req() req: any) {
    const scopedTenantId = req.targetTenantId ?? req.tenantId ?? null;
    const rows = scopedTenantId
      ? PROBE_ROWS.filter((r) => r.tenant_id === scopedTenantId)
      : [];
    return { ok: true, tenantId: scopedTenantId, rows };
  }

  @Post()
  post(@Req() req: any) {
    const scopedTenantId = req.targetTenantId ?? req.tenantId ?? null;
    return { ok: true, tenantId: scopedTenantId };
  }
}

export function buildMockKeycloakAuthService(): Partial<KeycloakAuthService> {
  return {
    verifyToken: jest.fn(async (req: any) => {
      const header = req.headers['authorization'];
      let result;
      if (header === 'Bearer valid-owner-token') {
        result = { isAuthenticated: true, userId: OWNER_USER_ID };
      } else if (header === 'Bearer valid-other-token') {
        result = { isAuthenticated: true, userId: OTHER_USER_ID };
      } else {
        result = { isAuthenticated: false, userId: null };
      }
      // Mirrors the real KeycloakAuthService, which sets req.user as a
      // side effect for the @User() param decorator to read.
      if (result.isAuthenticated) {
        req.user = { id: result.userId };
      }
      return result;
    }),
  };
}

export function buildMockFavoriteListService(): Partial<FavoriteListService> {
  return {
    findAll: jest.fn(async () => ({ items: [], total: 0 }) as any),
    findOne: jest.fn(async (id: string) => {
      if (id === 'private-list') {
        return {
          _id: id,
          ownerId: OWNER_USER_ID,
          privacy: 'PRIVATE',
          name: 'A private list',
          favorites: [],
        } as any;
      }
      return {
        _id: id,
        ownerId: OWNER_USER_ID,
        privacy: 'PUBLIC',
        name: 'A public list',
        favorites: [],
      } as any;
    }),
  };
}

export function buildStubConfigService(
  values: Record<string, any> = {},
): ConfigService {
  const merged: Record<string, any> = {
    permissionsSideChannelUrl: 'http://127.0.0.1:1', // unreachable by default
    ...values,
  };
  return { get: (key: string) => merged[key] } as unknown as ConfigService;
}

export interface BuildGatewayTestAppOptions {
  /** Registers GatewayIdentityGuard as APP_GUARD (ticket 01). Default true. */
  includeIdentityGuard?: boolean;
  /** Registers GatewayPermissionsGuard as APP_GUARD after the identity guard (ticket 02). */
  includePermissionsGuard?: boolean;
  /** Base URL of a stubbed permissions side-channel server, when includePermissionsGuard is true. */
  permissionsSideChannelBaseUrl?: string;
  /** Registers TenantScopeGuard as APP_GUARD after the permissions guard (ticket 03). */
  includeTenantScopeGuard?: boolean;
  extraProviders?: Provider[];
}

export async function buildGatewayTestApp(
  options: BuildGatewayTestAppOptions = {},
): Promise<INestApplication> {
  const {
    includeIdentityGuard = true,
    includePermissionsGuard = false,
    permissionsSideChannelBaseUrl,
    includeTenantScopeGuard = false,
    extraProviders = [],
  } = options;

  const guardProviders: Provider[] = [];
  if (includeIdentityGuard) {
    guardProviders.push({ provide: APP_GUARD, useClass: GatewayIdentityGuard });
  }
  if (includePermissionsGuard) {
    guardProviders.push(
      {
        provide: ConfigService,
        useValue: buildStubConfigService(
          permissionsSideChannelBaseUrl
            ? { permissionsSideChannelUrl: permissionsSideChannelBaseUrl }
            : {},
        ),
      },
      PermissionsSideChannelService,
      { provide: APP_GUARD, useClass: GatewayPermissionsGuard },
    );
  }
  if (includeTenantScopeGuard) {
    guardProviders.push({ provide: APP_GUARD, useClass: TenantScopeGuard });
  }

  @Module({
    controllers: [
      HealthController,
      FavoriteListController,
      TenantProbeController,
    ],
    providers: [
      HealthService,
      {
        provide: FavoriteListService,
        useValue: buildMockFavoriteListService(),
      },
      {
        provide: KeycloakAuthService,
        useValue: buildMockKeycloakAuthService(),
      },
      KeycloakGuard,
      ...guardProviders,
      ...extraProviders,
    ],
  })
  class GatewayTestModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
      consumer
        .apply(TenantMiddleware)
        .forRoutes(FavoriteListController, TenantProbeController);
    }
  }

  const moduleRef = await Test.createTestingModule({
    imports: [GatewayTestModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();
  return app;
}
