import type { Request } from 'express';
import {
  apiVersioningOptions,
  isV2Path,
  SUPPORTED_API_VERSIONS,
} from './api-version';

const extract = (req: Partial<Request>): string =>
  (
    apiVersioningOptions as unknown as {
      extractor: (r: unknown) => string;
    }
  ).extractor(req);

describe('isV2Path', () => {
  it.each([
    ['/v2/search', true],
    ['/v2', true],
    ['/v2/', true],
    ['/v2/search?query=a', true],
    ['/v2?x=1', true],
    ['/v2search', false],
    ['/v20/search', false],
    ['/search', false],
    ['/search?next=/v2/', false],
    ['/', false],
    ['', false],
  ])('%p -> %p', (path, expected) => {
    expect(isV2Path(path)).toBe(expected);
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
