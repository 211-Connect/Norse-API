import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import {
  CDN_CACHE_TTL_KEY,
  CDN_REQUIRES_URL_MIRRORS_KEY,
  CdnCacheControlInterceptor,
} from './cdn-cache-control.interceptor';

const NO_STORE = 'no-store, no-cache, must-revalidate, private';

interface Options {
  ttl?: number;
  flag?: boolean;
  query?: Record<string, unknown>;
  statusCode?: number;
  vary?: string;
}

async function run(options: Options): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  if (options.vary !== undefined) headers['Vary'] = options.vary;
  const request = { query: options.query ?? {}, headers: {}, url: '/v1/x' };
  const response = {
    statusCode: options.statusCode ?? 200,
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
    getHeader: (name: string) => headers[name],
  };
  const context = {
    getHandler: () => 'handler',
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
  const reflector = {
    get: (key: string) =>
      key === CDN_CACHE_TTL_KEY
        ? options.ttl
        : key === CDN_REQUIRES_URL_MIRRORS_KEY
          ? options.flag
          : undefined,
  } as unknown as Reflector;

  const interceptor = new CdnCacheControlInterceptor(reflector);
  await new Promise<void>((resolve, reject) =>
    interceptor
      .intercept(context, { handle: () => of({}) })
      .subscribe({ complete: resolve, error: reject }),
  );
  return headers;
}

describe('CdnCacheControlInterceptor', () => {
  const both = { tenant_id: 't1', locale: 'en' };

  it.each([
    ['no mirrors', {}],
    ['only tenant_id', { tenant_id: 't1' }],
    ['only locale', { locale: 'en' }],
    ['empty tenant_id', { tenant_id: '', locale: 'en' }],
  ])('is no-store when the flag is set and %s', async (_n, query) => {
    const headers = await run({ ttl: 900, flag: true, query });
    expect(headers['Cache-Control']).toBe(NO_STORE);
    expect(headers['Vary']).toBeUndefined();
  });

  it('is public with Vary when the flag is set and both mirrors exist', async () => {
    const headers = await run({ ttl: 900, flag: true, query: both });
    expect(headers['Cache-Control']).toBe('public, max-age=900, s-maxage=900');
    expect(headers['Vary']).toBe('x-tenant-id, accept-language');
  });

  // A route without the flag (geocoding) does not depend on tenant or
  // language, so it gets no Vary that would split caches for nothing.
  it('keeps public behaviour and adds no Vary when the flag is not set', async () => {
    const headers = await run({ ttl: 900, query: {} });
    expect(headers['Cache-Control']).toBe('public, max-age=900, s-maxage=900');
    expect(headers['Vary']).toBeUndefined();
  });

  it('appends to an existing Vary header', async () => {
    const headers = await run({
      ttl: 900,
      flag: true,
      query: both,
      vary: 'Origin',
    });
    expect(headers['Vary']).toBe('Origin, x-tenant-id, accept-language');
  });

  it('does not duplicate Vary values (case-insensitive)', async () => {
    const headers = await run({
      ttl: 900,
      flag: true,
      query: both,
      vary: 'Origin, X-Tenant-Id',
    });
    expect(headers['Vary']).toBe('Origin, X-Tenant-Id, accept-language');
  });

  it('is no-store when ttl is 0', async () => {
    const headers = await run({ ttl: 0, flag: true, query: both });
    expect(headers['Cache-Control']).toBe(NO_STORE);
  });

  it('sets no Cache-Control for a non-200 status', async () => {
    const headers = await run({ ttl: 900, query: both, statusCode: 404 });
    expect(headers['Cache-Control']).toBeUndefined();
  });

  it('sets no Cache-Control when ttl is undefined', async () => {
    const headers = await run({ flag: true, query: both });
    expect(headers['Cache-Control']).toBeUndefined();
  });
});
