import { relevanceCutoffCacheKey } from './relevance-cutoff-cache-key';

const base = {
  tenantId: 'tenant-a',
  lang: 'en',
  queryStr: 'free dental care',
  filters: { category: ['health'] },
  taxonomies: ['LV-1600'],
  coords: [-122.03, 36.97],
  distance: 25,
  age: undefined,
  geoType: undefined,
  organizationId: undefined,
  geometry: null,
  pinnedMode: 'boost',
};

describe('relevanceCutoffCacheKey', () => {
  it('is stable for identical inputs', () => {
    expect(relevanceCutoffCacheKey(base)).toBe(relevanceCutoffCacheKey(base));
  });

  it('carries tenant and language in the clear', () => {
    expect(relevanceCutoffCacheKey(base)).toMatch(
      /^search:cutoff:tenant-a:en:/,
    );
  });

  // The probe drops the pinned boost clause entirely under `ignore`, which
  // moves every score and can move the elbow. Keyed together, a tenant that
  // changed its pinned_resources_mode was served a probe decided under the old
  // mode until the entry expired.
  it('separates pinned_resources_mode, because the probe scores differently under it', () => {
    expect(relevanceCutoffCacheKey({ ...base, pinnedMode: 'ignore' })).not.toBe(
      relevanceCutoffCacheKey({ ...base, pinnedMode: 'boost' }),
    );
  });

  it.each([
    ['queryStr', { queryStr: 'legal aid' }],
    ['filters', { filters: { category: ['legal'] } }],
    ['taxonomies', { taxonomies: ['FT-3200'] }],
    ['coords', { coords: [-93.1, 44.9] }],
    ['distance', { distance: 50 }],
    ['organizationId', { organizationId: 'org-1' }],
  ])('separates a change in %s', (_label, override) => {
    expect(relevanceCutoffCacheKey({ ...base, ...override })).not.toBe(
      relevanceCutoffCacheKey(base),
    );
  });

  // Deliberate: the cut is a property of the result set, not of the page or of
  // the order the caller wants the survivors in. Pages 2..n must reuse one
  // probe or the kept set drifts between pages.
  it('ignores page, limit and sort', () => {
    const withPaging = {
      ...base,
      page: 3,
      limit: 50,
      sort: 'distance',
    } as unknown as typeof base;

    expect(relevanceCutoffCacheKey(withPaging)).toBe(
      relevanceCutoffCacheKey(base),
    );
  });
});
