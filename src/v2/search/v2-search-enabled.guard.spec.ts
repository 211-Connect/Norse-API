import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { V2SearchEnabledGuard } from './v2-search-enabled.guard';

const make = (value: unknown) =>
  new V2SearchEnabledGuard({
    get: jest.fn(() => value),
  } as unknown as ConfigService);

describe('V2SearchEnabledGuard', () => {
  it.each(['true', 'TRUE', 'True'])(
    'env %p: open for every tenant (no Payload enableV2Api check)',
    (value) => {
      expect(make(value).canActivate()).toBe(true);
    },
  );

  it.each([undefined, '', 'false', '1', 'yes', ' true', 'true ', true])(
    'env %p: 404',
    (value) => {
      expect(() => make(value).canActivate()).toThrow(NotFoundException);
    },
  );

  it('depends on ConfigService only, so it never reads tenant config', () => {
    expect(V2SearchEnabledGuard.length).toBe(1);
  });
});
