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

  // ISS-2496: the path alone picks the version, so one URL answers one
  // version. The x-api-version header never changes a stored body (1 is
  // ignored, anything else is a 400), so nothing varies on it.
  describe.each([
    ['legacy path', '/search?query=food', undefined],
    ['legacy path, header 1', '/search?query=food', '1'],
    ['/v1 path', '/v1/search?query=food', undefined],
    ['/v2 path', '/v2/search?query=food', undefined],
    ['/v3 path', '/v3/search', undefined],
  ])('%s', (_label, url, apiVersionHeader) => {
    it('is stored, with no Vary on the version header', async () => {
      const h = await run({ ttl: 3600, url, apiVersionHeader });
      expect(h['cache-control']).toBe(PUBLIC_HOUR);
      expect(h['vary']).toBeUndefined();
    });
  });

  it('keeps an existing Vary as it is', async () => {
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
    expect(headers['vary']).toBe('Origin');
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
