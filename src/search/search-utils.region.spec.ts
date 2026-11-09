import { SearchUtilsService } from './search-utils.service';

const shape = (id: string) => ({
  indexed_shape: { index: 'regions', id, path: 'geometry' },
  relation: 'intersects',
});

describe('SearchUtilsService.buildFilters with regions (area search)', () => {
  const build = (regionIds?: string[]) =>
    SearchUtilsService.buildFilters(
      {},
      [-120.5, 46.6],
      25,
      undefined,
      undefined,
      undefined,
      undefined,
      regionIds,
    );

  it('matches service_area overlap OR location inside, for each Region', () => {
    expect(build(['county:53077', 'zip:98901'])).toEqual([
      {
        bool: {
          should: [
            { geo_shape: { service_area: shape('county:53077') } },
            { geo_shape: { 'location.point': shape('county:53077') } },
            { geo_shape: { service_area: shape('zip:98901') } },
            { geo_shape: { 'location.point': shape('zip:98901') } },
          ],
          minimum_should_match: 1,
        },
      },
    ]);
  });

  it('drops the point rules (containment and radius) when Regions are given', () => {
    const json = JSON.stringify(build(['county:53077']));
    expect(json).not.toContain('geo_distance');
    expect(json).not.toContain('contains');
  });

  it('keeps the point rules without Regions', () => {
    const json = JSON.stringify(build([]));
    expect(json).toContain('geo_distance');
    expect(json).toContain('contains');
  });
});
