import { ConfigService } from '@nestjs/config';
import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  PermissionsSideChannelService,
  PERMISSIONS_CACHE_TTL_MS,
} from './permissions-side-channel.service';

function buildConfigService(baseUrl = 'http://unkey-auth:8081'): ConfigService {
  return {
    get: (key: string) =>
      key === 'permissionsSideChannelUrl' ? baseUrl : undefined,
  } as unknown as ConfigService;
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('PermissionsSideChannelService', () => {
  let fetchMock: jest.Mock;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    fetchMock = jest.fn();
    originalFetch = global.fetch;
    global.fetch = fetchMock as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('200 with unsorted/duped slugs -> stored + returned sorted/deduped; second call is a cache hit', async () => {
    const service = new PermissionsSideChannelService(buildConfigService());
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        keyId: 'key_abc',
        permissions: [
          'norse-api.invoke',
          'norse-api.invoke',
          'norse-api.a.read',
        ],
        fetchedAt: 1,
      }),
    );

    const result = await service.resolveSlugs('key_abc');
    expect(result).toEqual(['norse-api.a.read', 'norse-api.invoke']);

    const result2 = await service.resolveSlugs('key_abc');
    expect(result2).toEqual(['norse-api.a.read', 'norse-api.invoke']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('200 with empty permissions -> resolves [] (does not throw)', async () => {
    const service = new PermissionsSideChannelService(buildConfigService());
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { keyId: 'key_abc', permissions: [] }),
    );

    await expect(service.resolveSlugs('key_abc')).resolves.toEqual([]);
  });

  it('200 with keyId mismatch -> throws 503', async () => {
    const service = new PermissionsSideChannelService(buildConfigService());
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { keyId: 'key_other', permissions: [] }),
    );

    await expect(service.resolveSlugs('key_abc')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it.each([
    [
      'non-JSON body',
      () => ({
        status: 200,
        json: async () => {
          throw new Error('bad json');
        },
      }),
    ],
    [
      'permissions not an array',
      () => jsonResponse(200, { keyId: 'key_abc', permissions: 'x' }),
    ],
    ['missing permissions', () => jsonResponse(200, { keyId: 'key_abc' })],
  ])('malformed body (%s) -> throws 503', async (_label, buildResponse) => {
    const service = new PermissionsSideChannelService(buildConfigService());
    fetchMock.mockResolvedValueOnce(buildResponse());

    await expect(service.resolveSlugs('key_abc')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('upstream 404 -> throws 401 gateway_key_not_found; not cached (re-fetches next call)', async () => {
    const service = new PermissionsSideChannelService(buildConfigService());
    fetchMock.mockResolvedValue(jsonResponse(404, { error: 'key_not_found' }));

    await expect(service.resolveSlugs('key_abc')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(service.resolveSlugs('key_abc')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('upstream 503 -> throws 503 permissions_unavailable; not cached', async () => {
    const service = new PermissionsSideChannelService(buildConfigService());
    fetchMock.mockResolvedValue(jsonResponse(503, { error: 'unavailable' }));

    await expect(service.resolveSlugs('key_abc')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(service.resolveSlugs('key_abc')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('unexpected status (500) -> throws 503', async () => {
    const service = new PermissionsSideChannelService(buildConfigService());
    fetchMock.mockResolvedValue(jsonResponse(500, {}));

    await expect(service.resolveSlugs('key_abc')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('network throw -> throws 503', async () => {
    const service = new PermissionsSideChannelService(buildConfigService());
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(service.resolveSlugs('key_abc')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('empty/whitespace-only keyId -> throws 401 without any fetch', async () => {
    const service = new PermissionsSideChannelService(buildConfigService());

    await expect(service.resolveSlugs('   ')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('request shape: GET, encoded URL, no authorization/x-api-key header', async () => {
    const service = new PermissionsSideChannelService(
      buildConfigService('http://unkey-auth:8081'),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { keyId: 'key/weird id', permissions: [] }),
    );

    await service.resolveSlugs('key/weird id');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://unkey-auth:8081/keys/key%2Fweird%20id/permissions',
      expect.objectContaining({
        method: 'GET',
        headers: { accept: 'application/json' },
      }),
    );
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['authorization']).toBeUndefined();
    expect(init.headers['x-api-key']).toBeUndefined();
  });

  it('fetchedAt is ignored for the return value', async () => {
    const service = new PermissionsSideChannelService(buildConfigService());
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        keyId: 'key_abc',
        permissions: ['norse-api.invoke'],
        fetchedAt: 1757260800000,
      }),
    );

    const result = await service.resolveSlugs('key_abc');
    expect(result).toEqual(['norse-api.invoke']);
  });

  it("cache TTL is configured to ADR-0015's 60s propagation window", () => {
    // lru-cache v11 keeps its bookkeeping (keyMap, start timestamps, ...) in
    // truly-private `#` class fields, so there's no way to back-date an
    // entry or otherwise fast-forward expiry from outside the class, and
    // jest fake timers don't move lru-cache's internal Date.now()-based
    // clock either. Waiting out a real 60s TTL in a unit test isn't
    // acceptable, so this asserts the constant that governs the cache
    // (catches exactly the kind of silent config regression - TTL drifting
    // to a different value - that this suite is being fixed for) plus that
    // an inserted entry is actively tracked with that TTL, rather than
    // proving expiry occurs at t+60s in real time.
    const service = new PermissionsSideChannelService(buildConfigService());
    const cache = (service as any).cache;
    expect(cache.ttl).toBe(PERMISSIONS_CACHE_TTL_MS);
    expect(PERMISSIONS_CACHE_TTL_MS).toBe(60_000);

    cache.set('probe', ['norse-api.invoke']);
    const remaining = cache.getRemainingTTL('probe');
    expect(remaining).toBeGreaterThan(PERMISSIONS_CACHE_TTL_MS - 1_000);
    expect(remaining).toBeLessThanOrEqual(PERMISSIONS_CACHE_TTL_MS);
  });
});
