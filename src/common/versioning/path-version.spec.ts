import { resolvePathVersion } from './path-version';

const SUPPORTED = ['1', '2'];

describe('resolvePathVersion (ISS-2496, ADR 0039 Decision 10)', () => {
  it.each([
    ['/v1/search', '1', '/search'],
    ['/v2/search', '2', '/search'],
    ['/v1/search?query=a&lat=1', '1', '/search?query=a&lat=1'],
    ['/v1/resource/abc/def', '1', '/resource/abc/def'],
    ['/v1', '1', '/'],
    ['/v1/', '1', '/'],
    ['/v1?x=1', '1', '/?x=1'],
  ])('%s -> version %s, url %s', (url, version, rewritten) => {
    expect(resolvePathVersion(url, SUPPORTED)).toEqual({
      version,
      url: rewritten,
    });
  });

  it.each([
    '/search',
    '/search?x=/v1/y',
    '/health',
    '/v9/search',
    '/v0/search',
    '/v01/search',
    '/v1x/search',
    '/vv1/search',
    '/V1/search',
    '/resource/v1/x',
    '/versions',
    '',
  ])('%p has no supported version prefix, so it is left alone', (url) => {
    expect(resolvePathVersion(url, SUPPORTED)).toBeNull();
  });

  it('a version that no route is declared under is left alone', () => {
    expect(resolvePathVersion('/v2/search', ['1'])).toBeNull();
  });
});
