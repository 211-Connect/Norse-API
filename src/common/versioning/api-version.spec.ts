import { VERSION_NEUTRAL, VersioningType } from '@nestjs/common';
import {
  apiVersioningOptions,
  pathVersionOf,
  V1_AND_LEGACY,
} from './api-version';

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

describe('apiVersioningOptions (ISS-2496)', () => {
  it('routes by the path only (URI versioning), never by a header', () => {
    expect(apiVersioningOptions.type).toBe(VersioningType.URI);
    expect('extractor' in apiVersioningOptions).toBe(false);
  });

  it('a route with no version of its own serves /v1/<route> and the legacy /<route>', () => {
    expect(V1_AND_LEGACY).toEqual(['1', VERSION_NEUTRAL]);
    expect(
      (apiVersioningOptions as { defaultVersion?: unknown }).defaultVersion,
    ).toBe(V1_AND_LEGACY);
  });
});
