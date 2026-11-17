import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import {
  CdnCacheControlInterceptor,
  markNotStorable,
} from './cdn-cache-control.interceptor';

const NO_STORE = 'no-store, no-cache, must-revalidate, private';
const PUBLIC_HOUR = 'public, max-age=3600, s-maxage=3600';

function run(opts: {
  ttl: number | undefined;
  url: string;
  apiVersionHeader?: string;
  status?: number;
  body?: unknown;
}) {
  const headers: Record<string, string> = {};
  const res = {
    statusCode: opts.status ?? 200,
    setHeader: (k: string, v: string) => (headers[k.toLowerCase()] = v),
    getHeader: (k: string) => headers[k.toLowerCase()],
  };
  const req = {
    originalUrl: opts.url,
    url: opts.url,
    headers:
      opts.apiVersionHeader === undefined
        ? {}
        : { 'x-api-version': opts.apiVersionHeader },
  };
  const context = {
    getHandler: () => () => undefined,
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
  } as unknown as ExecutionContext;
  const reflector = { get: () => opts.ttl } as unknown as Reflector;
  const next: CallHandler = { handle: () => of(opts.body ?? { ok: true }) };
  return lastValueFrom(
    new CdnCacheControlInterceptor(reflector).intercept(context, next),
  ).then(() => headers);
}

describe('CdnCacheControlInterceptor', () => {
  it('leaves routes without a TTL alone', async () => {
    const h = await run({ ttl: undefined, url: '/search' });
    expect(h['cache-control']).toBeUndefined();
  });

  it('keeps TTL 0 as no-store', async () => {
    const h = await run({ ttl: 0, url: '/search' });
    expect(h['cache-control']).toBe(NO_STORE);
  });

  it('writes nothing for a non-200 response', async () => {
    const h = await run({ ttl: 3600, url: '/search', status: 400 });
    expect(h['cache-control']).toBeUndefined();
  });

  describe('a path the x-api-version header can switch', () => {
    it('stores a v1 response and varies it on the version header', async () => {
      const h = await run({ ttl: 3600, url: '/search?query=food' });
      expect(h['cache-control']).toBe(PUBLIC_HOUR);
      expect(h['vary']).toBe('x-api-version');
    });

    it('stores an explicit v1 the same way', async () => {
      const h = await run({
        ttl: 3600,
        url: '/search?query=food',
        apiVersionHeader: '1',
      });
      expect(h['cache-control']).toBe(PUBLIC_HOUR);
      expect(h['vary']).toBe('x-api-version');
    });

    // A cache keyed by URL only would hand this body to v1 callers of the
    // same URL, and v1 bodies to v2 callers (ADR 0039 Decision 9, Question 11).
    it('never stores a version the header picked over the default', async () => {
      const h = await run({
        ttl: 3600,
        url: '/search?query=food',
        apiVersionHeader: '2',
      });
      expect(h['cache-control']).toBe(NO_STORE);
    });

    it('appends to an existing Vary instead of replacing it', async () => {
      const headers: Record<string, string> = { vary: 'Origin' };
      const res = {
        statusCode: 200,
        setHeader: (k: string, v: string) => (headers[k.toLowerCase()] = v),
        getHeader: (k: string) => headers[k.toLowerCase()],
      };
      const context = {
        getHandler: () => () => undefined,
        switchToHttp: () => ({
          getResponse: () => res,
          getRequest: () => ({ originalUrl: '/search', headers: {} }),
        }),
      } as unknown as ExecutionContext;
      await lastValueFrom(
        new CdnCacheControlInterceptor({
          get: () => 3600,
        } as unknown as Reflector).intercept(context, {
          handle: () => of({}),
        }),
      );
      expect(headers['vary']).toBe('Origin, x-api-version');
    });
  });

  describe('a version in the path', () => {
    it('stores the response with no Vary on the header', async () => {
      const h = await run({
        ttl: 3600,
        url: '/v2/search?query=food',
        apiVersionHeader: '1',
      });
      expect(h['cache-control']).toBe(PUBLIC_HOUR);
      expect(h['vary']).toBeUndefined();
    });
  });

  describe('a response its handler marked not storable', () => {
    it('is no-store whatever the route TTL', async () => {
      const body = markNotStorable({ hits: [] });
      const h = await run({ ttl: 3600, url: '/v2/search', body });
      expect(h['cache-control']).toBe(NO_STORE);
    });

    it('adds no field to the JSON body', () => {
      const body = markNotStorable({ hits: [] });
      expect(JSON.parse(JSON.stringify(body))).toEqual({ hits: [] });
      expect(body).toEqual({ hits: [] });
    });
  });
});
