import { fusedOrderCacheKey } from './fused-order-cache-key';

const base = {
  tenantId: 'tenant-a',
  lang: 'en',
  queryStr: 'food pantry',
  filters: {},
  taxonomies: [],
  coords: [-87.63, 41.88],
  distance: 25,
  age: undefined,
  geoType: undefined,
  organizationId: undefined,
  geometry: null,
  pinnedMode: 'boost',
  sort: 'relevance',
  cutoff: false,
};

describe('fusedOrderCacheKey', () => {
  it('is stable and carries tenant and language in the clear', () => {
    expect(fusedOrderCacheKey(base)).toBe(fusedOrderCacheKey({ ...base }));
    expect(fusedOrderCacheKey(base)).toMatch(
      /^search:fused:tenant-a:en:.*:v2$/,
    );
  });

  it.each([
    ['query', { queryStr: 'food bank' }],
    ['coords', { coords: [-89.59, 40.69] }],
    ['sort', { sort: 'distance' }],
    ['cutoff', { cutoff: true }],
    ['pinned mode', { pinnedMode: 'ignore' }],
    ['needs', { needs: [{ code: 'N-FOOD-01', tier: 'tier1', score: 0.9 }] }],
  ])('changes with %s', (_, change) => {
    expect(fusedOrderCacheKey({ ...base, ...change })).not.toBe(
      fusedOrderCacheKey(base),
    );
  });

  it('ignores the order of the needs', () => {
    const a = { code: 'N-A', tier: 'tier1', score: 0.9 };
    const b = { code: 'N-B', tier: 'tier2', score: 0.7 };
    expect(fusedOrderCacheKey({ ...base, needs: [a, b] })).toBe(
      fusedOrderCacheKey({ ...base, needs: [b, a] }),
    );
  });
});
