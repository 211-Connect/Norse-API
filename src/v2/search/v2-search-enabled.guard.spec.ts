import {
  ExecutionContext,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TenantConfigService } from '../../cms-config/tenant-config.service';
import { V2SearchEnabledGuard } from './v2-search-enabled.guard';

const TENANT = '11111111-1111-4111-8111-111111111111';

const setHeader = jest.fn();
beforeEach(() => setHeader.mockClear());

const ctx = (query: Record<string, unknown>) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ query }),
      getResponse: () => ({ setHeader }),
    }),
  }) as unknown as ExecutionContext;

type Flag = { enabled: boolean; degraded?: boolean; unknown?: boolean };
const make = (value: unknown, isV2: boolean | Flag = true) => {
  const isV2Tenant = jest.fn(async () =>
    typeof isV2 === 'boolean'
      ? { enabled: isV2, degraded: false, unknown: false }
      : { degraded: false, unknown: false, ...isV2 },
  );
  const guard = new V2SearchEnabledGuard(
    { get: jest.fn(() => value) } as unknown as ConfigService,
    { getV2TenantFlag: isV2Tenant } as unknown as TenantConfigService,
  );
  return { guard, isV2Tenant };
};

describe('V2SearchEnabledGuard', () => {
  it('env on and tenant flag on: lets the request through', async () => {
    const { guard, isV2Tenant } = make('true', true);
    await expect(guard.canActivate(ctx({ tenant_id: TENANT }))).resolves.toBe(
      true,
    );
    expect(isV2Tenant).toHaveBeenCalledWith(TENANT);
  });

  it('env on and tenant flag off: 404', async () => {
    const { guard } = make('true', false);
    await expect(
      guard.canActivate(ctx({ tenant_id: TENANT })),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([undefined, '', 'false', 'TRUE', '1', 'yes', ' true', true])(
    'env %p: 404 and the tenant flag is not read',
    async (value) => {
      const { guard, isV2Tenant } = make(value, true);
      await expect(
        guard.canActivate(ctx({ tenant_id: TENANT })),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(isV2Tenant).not.toHaveBeenCalled();
    },
  );

  it('no tenant_id in the URL: passes so V2UrlMirrorsGuard answers 400', async () => {
    const { guard, isV2Tenant } = make('true', false);
    await expect(guard.canActivate(ctx({}))).resolves.toBe(true);
    expect(isV2Tenant).not.toHaveBeenCalled();
  });

  it.each(['x'.repeat(5000), '../../etc', 'not-a-uuid', 'a:b'])(
    'tenant_id that is not a UUID never reaches Redis or the caches: %#',
    async (bad) => {
      const { guard, isV2Tenant } = make('true', true);
      await expect(guard.canActivate(ctx({ tenant_id: bad }))).resolves.toBe(
        true,
      );
      expect(isV2Tenant).not.toHaveBeenCalled();
    },
  );

  it('Redis up: no X-Degraded header', async () => {
    const { guard } = make('true', true);
    await guard.canActivate(ctx({ tenant_id: TENANT }));
    expect(setHeader).not.toHaveBeenCalled();
  });

  it('Redis down, known on: passes with X-Degraded', async () => {
    const { guard } = make('true', { enabled: true, degraded: true });
    await expect(guard.canActivate(ctx({ tenant_id: TENANT }))).resolves.toBe(
      true,
    );
    expect(setHeader).toHaveBeenCalledWith('X-Degraded', 'tenant-flag-cache');
  });

  it('Redis down, known off: 404 with X-Degraded', async () => {
    const { guard } = make('true', { enabled: false, degraded: true });
    await expect(
      guard.canActivate(ctx({ tenant_id: TENANT })),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(setHeader).toHaveBeenCalledWith('X-Degraded', 'tenant-flag-cache');
  });

  it('Redis down, tenant never seen: 503 with Retry-After 5', async () => {
    const { guard } = make('true', {
      enabled: false,
      degraded: true,
      unknown: true,
    });
    await expect(
      guard.canActivate(ctx({ tenant_id: TENANT })),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '5');
  });

  it('env off and Redis down: still 404, nothing read', async () => {
    const { guard, isV2Tenant } = make('false', {
      enabled: false,
      degraded: true,
      unknown: true,
    });
    await expect(
      guard.canActivate(ctx({ tenant_id: TENANT })),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(isV2Tenant).not.toHaveBeenCalled();
  });
});
