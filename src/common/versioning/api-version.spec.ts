import type { Request } from 'express';
import {
  apiVersioningOptions,
  pathVersionOf,
  SUPPORTED_API_VERSIONS,
} from './api-version';

const extract = (req: Partial<Request>): string =>
  (
    apiVersioningOptions as unknown as {
      extractor: (r: unknown) => string;
    }
  ).extractor(req);

describe('pathVersionOf', () => {
  it.each([
    ['/v1/search', '1'],
    ['/v2/search', '2'],
    ['/v2', '2'],
    ['/v2/', '2'],
    ['/v2?x=1', '2'],
    ['/v2/search?query=a', '2'],
    ['/v3/resource/abc', '3'],
    ['/v10/search', '10'],
  ])('%p -> %p', (path, expected) => {
    expect(pathVersionOf(path)).toBe(expected);
  });

  it.each([
    '/search',
    '/search?next=/v2/',
    '/v2search',
    '/vv2/search',
    '/V2/search',
    '/v/search',
    '/resource/v2/x',
    '/',
    '',
  ])('%p has no version in the path', (path) => {
    expect(pathVersionOf(path)).toBeUndefined();
  });
});

describe('apiVersioningOptions extractor', () => {
  it('supports versions 1 and 2', () => {
    expect(SUPPORTED_API_VERSIONS).toEqual(['1', '2']);
  });

  it('returns 2 for a /v2/ path, whatever the header says', () => {
    expect(extract({ originalUrl: '/v2/search?query=a', headers: {} })).toBe(
      '2',
    );
    expect(
      extract({ originalUrl: '/v2/search', headers: { 'x-api-version': '1' } }),
    ).toBe('2');
  });

  it('falls back to url when originalUrl is missing', () => {
    expect(extract({ url: '/v2/search', headers: {} })).toBe('2');
  });

  it('keeps the header, then the default 1, for other paths', () => {
    expect(
      extract({ originalUrl: '/search', headers: { 'x-api-version': '2' } }),
    ).toBe('2');
    expect(extract({ originalUrl: '/search', headers: {} })).toBe('1');
    expect(extract({ originalUrl: '/search?x=/v2/', headers: {} })).toBe('1');
  });
});
