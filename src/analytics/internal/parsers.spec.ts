import { parseMetrics } from './parsers';
import type { MetricsExpandedEntry } from '../types';

const entry = (name: string, pageviews: number): MetricsExpandedEntry => ({
  name,
  pageviews: String(pageviews),
  visitors: 0,
  visits: 0,
  bounces: 0,
  totaltime: '0',
});

describe('parseMetrics', () => {
  it('counts an exact /search path as searchCount by default', () => {
    const { searchCount, resourceMetrics } = parseMetrics(
      [entry('/search', 5)],
      [],
    );

    expect(searchCount).toBe(5);
    expect(resourceMetrics).toEqual([]);
  });

  it('counts a nested /search path (e.g. /en/search) as searchCount by default', () => {
    const { searchCount } = parseMetrics([entry('/en/search', 3)], []);

    expect(searchCount).toBe(3);
  });

  it('counts /search/xyz as a resource metric by default', () => {
    const { searchCount, resourceMetrics } = parseMetrics(
      [entry('/search/123', 2)],
      [],
    );

    expect(searchCount).toBe(0);
    expect(resourceMetrics).toEqual([{ x: '/search/123', y: 2 }]);
  });

  it('does not change behavior when hasTrailingSlash is false explicitly', () => {
    const data = [entry('/search', 4), entry('/search/abc', 6)];
    const withoutFlag = parseMetrics(data, []);
    const withFalseFlag = parseMetrics(data, [], false);

    expect(withFalseFlag).toEqual(withoutFlag);
  });

  describe('when hasTrailingSlash is true', () => {
    it('counts a bare /search path (no trailing slash) as searchCount', () => {
      const { searchCount, resourceMetrics } = parseMetrics(
        [entry('/search', 7)],
        [],
        true,
      );

      expect(searchCount).toBe(7);
      expect(resourceMetrics).toEqual([]);
    });

    it('counts a /search/ path (with trailing slash) as searchCount', () => {
      const { searchCount, resourceMetrics } = parseMetrics(
        [entry('/search/', 8)],
        [],
        true,
      );

      expect(searchCount).toBe(8);
      expect(resourceMetrics).toEqual([]);
    });

    it('counts a nested bare /en/search path as searchCount', () => {
      const { searchCount } = parseMetrics([entry('/en/search', 9)], [], true);

      expect(searchCount).toBe(9);
    });

    it('still counts /search/123 as a resource metric, not searchCount', () => {
      const { searchCount, resourceMetrics } = parseMetrics(
        [entry('/search/123', 10)],
        [],
        true,
      );

      expect(searchCount).toBe(0);
      expect(resourceMetrics).toEqual([{ x: '/search/123', y: 10 }]);
    });

    it('strips a trailing slash from a /search/123/ resource path', () => {
      const { searchCount, resourceMetrics } = parseMetrics(
        [entry('/search/0003527d-3d58-520b-8cee-986f8f447118/', 5)],
        [],
        true,
      );

      expect(searchCount).toBe(0);
      expect(resourceMetrics).toEqual([
        { x: '/search/0003527d-3d58-520b-8cee-986f8f447118', y: 5 },
      ]);
    });

    it('counts a /search/?query=abc path (trailing slash + query string) as searchCount', () => {
      const { searchCount, resourceMetrics } = parseMetrics(
        [entry('/search/?query=abc', 11)],
        [],
        true,
      );

      expect(searchCount).toBe(11);
      expect(resourceMetrics).toEqual([]);
    });

    it('counts a nested /en/search/?query=abc path as searchCount', () => {
      const { searchCount } = parseMetrics(
        [entry('/en/search/?query=abc', 12)],
        [],
        true,
      );

      expect(searchCount).toBe(12);
    });
  });

  it('counts a /search?query=abc path as searchCount regardless of hasTrailingSlash', () => {
    const { searchCount, resourceMetrics } = parseMetrics(
      [entry('/search?query=abc', 13)],
      [],
    );

    expect(searchCount).toBe(13);
    expect(resourceMetrics).toEqual([]);
  });
});
