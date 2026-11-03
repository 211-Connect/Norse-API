import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import { ArcjetGuard } from './arcjet.guard';

// @arcjet/nest is ESM-only; ts-jest (CJS) can only load it through a mock.
jest.mock('@arcjet/nest', () => ({
  ARCJET: 'ARCJET',
  ArcjetNest: class {},
}));

function createContext(request: Partial<Request>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('ArcjetGuard logging privacy', () => {
  const request = {
    method: 'GET',
    url: '/v1/search?query=crisis%20line&lat=43.65&lng=-79.38',
    originalUrl: '/v1/search?query=crisis%20line&lat=43.65&lng=-79.38',
    headers: { 'x-tenant-id': 'tenant-1' },
  } as unknown as Request;

  function buildGuard(decision: unknown) {
    const guard = new ArcjetGuard(
      { protect: jest.fn().mockResolvedValue(decision) } as never,
      {
        get: jest.fn().mockReturnValue('arcjet-key'),
      } as unknown as ConfigService,
    );
    const logger = (
      guard as unknown as { logger: { warn: jest.Mock; error: jest.Mock } }
    ).logger;
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const error = jest
      .spyOn(logger, 'error')
      .mockImplementation(() => undefined);
    return { guard, warn, error };
  }

  it('logs the path without the query string when a request is denied', async () => {
    const { guard, warn } = buildGuard({
      isDenied: () => true,
      isErrored: () => false,
      reason: { type: 'RATE_LIMIT' },
    });

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);

    expect(warn).toHaveBeenCalledTimes(1);
    const logged = warn.mock.calls[0][0] as { pathName: string };
    expect(logged.pathName).toBe('/v1/search');
    const serialized = JSON.stringify(logged);
    expect(serialized).not.toContain('crisis');
    expect(serialized).not.toContain('43.65');
    expect(serialized).not.toContain('?');
  });

  it('logs the path without the query string when Arcjet errors', async () => {
    const { guard, error } = buildGuard({
      isDenied: () => false,
      isErrored: () => true,
      reason: { type: 'ERROR' },
    });

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);

    expect(error).toHaveBeenCalledTimes(1);
    const logged = error.mock.calls[0][0] as { pathName: string };
    expect(logged.pathName).toBe('/v1/search');
    expect(JSON.stringify(logged)).not.toContain('crisis');
  });
});
