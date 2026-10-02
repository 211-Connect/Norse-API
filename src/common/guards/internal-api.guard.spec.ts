import { timingSafeEqual } from 'crypto';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InternalApiGuard } from './internal-api.guard';

jest.mock('crypto', () => {
  const actual = jest.requireActual('crypto');
  return { ...actual, timingSafeEqual: jest.fn(actual.timingSafeEqual) };
});

const KEY = 'the-internal-key';

describe('InternalApiGuard', () => {
  const guardWith = (configured: string | undefined) =>
    new InternalApiGuard({
      get: (name: string) => (name === 'internalApiKey' ? configured : null),
    } as unknown as ConfigService);

  const contextWith = (headers: Record<string, unknown>): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ headers }) }),
    }) as unknown as ExecutionContext;

  beforeEach(() => jest.mocked(timingSafeEqual).mockClear());

  it('passes the configured key', () => {
    expect(
      guardWith(KEY).canActivate(contextWith({ 'x-internal-api-key': KEY })),
    ).toBe(true);
  });

  it.each([
    ['missing', {}],
    ['empty', { 'x-internal-api-key': '' }],
    ['wrong', { 'x-internal-api-key': 'the-internal-kez' }],
    ['a prefix', { 'x-internal-api-key': KEY.slice(0, -1) }],
    ['longer', { 'x-internal-api-key': `${KEY}x` }],
    ['repeated', { 'x-internal-api-key': [KEY, KEY] }],
  ])('rejects a %s key with 401', (_label, headers) => {
    expect(() => guardWith(KEY).canActivate(contextWith(headers))).toThrow(
      UnauthorizedException,
    );
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
  ])(
    'fails closed when INTERNAL_API_KEY is %s, whatever the request sends',
    (_label, configured) => {
      for (const headers of [
        {},
        { 'x-internal-api-key': '' },
        { 'x-internal-api-key': 'anything' },
      ]) {
        expect(() =>
          guardWith(configured).canActivate(contextWith(headers)),
        ).toThrow(UnauthorizedException);
      }
    },
  );

  it('compares keys in constant time', () => {
    guardWith(KEY).canActivate(contextWith({ 'x-internal-api-key': KEY }));
    expect(timingSafeEqual).toHaveBeenCalled();
  });
});
