import { requestPathForLog } from './request-path';

describe('requestPathForLog', () => {
  it('drops the query string from express URLs', () => {
    expect(
      requestPathForLog({
        originalUrl: '/v1/search?query=crisis%20line&lat=43.65',
        url: '/v1/search?query=crisis%20line',
      }),
    ).toBe('/v1/search');
  });

  it('falls back to url, then to "/"', () => {
    expect(requestPathForLog({ url: '/health?probe=1' })).toBe('/health');
    expect(requestPathForLog({})).toBe('/');
    expect(requestPathForLog({ url: '' })).toBe('/');
  });

  it('keeps the origin but drops userinfo, query and fragment of absolute URLs', () => {
    expect(
      requestPathForLog({
        url: 'https://user:password@example.test/search?query=crisis#top',
      }),
    ).toBe('https://example.test/search');
  });
});
