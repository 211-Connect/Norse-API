import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TenantConfigService } from '../../cms-config/tenant-config.service';
import { V2SearchEnabledGuard } from './v2-search-enabled.guard';

const TENANT = '11111111-1111-4111-8111-111111111111';

const ctx = (query: Record<string, unknown>) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ query }) }),
  }) as unknown as ExecutionContext;

const make = (value: unknown, isV2: boolean | Error = true) => {
  const isV2Tenant = jest.fn(async () => {
    if (isV2 instanceof Error) throw isV2;
    return isV2;
  });
  const guard = new V2SearchEnabledGuard(
    { get: jest.fn(() => value) } as unknown as ConfigService,
    { isV2Tenant } as unknown as TenantConfigService,
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
});
