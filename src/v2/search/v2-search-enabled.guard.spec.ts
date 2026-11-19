import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { V2SearchEnabledGuard } from './v2-search-enabled.guard';

const guard = (value: unknown) =>
  new V2SearchEnabledGuard({
    get: jest.fn(() => value),
  } as unknown as ConfigService);

describe('V2SearchEnabledGuard', () => {
  it('lets the request through only for the exact string "true"', () => {
    expect(guard('true').canActivate()).toBe(true);
  });

  it.each([undefined, '', 'false', 'TRUE', '1', 'yes', ' true', true])(
    'answers 404 for %p',
    (value) => {
      expect(() => guard(value).canActivate()).toThrow(NotFoundException);
    },
  );
});
