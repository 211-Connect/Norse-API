import { SearchUtilsService } from './search-utils.service';

// Facet filters built by SearchUtilsService.buildFilters.
//
// Decision 1A (Lucas, 2026-11-18): in v2 search, ticked values inside one
// facet are OR, and different facets are AND. v1 and v1 hybrid keep AND for
// every ticked value, so existing callers see no change.

const pair = (field: string, item: string) => [
  { term: { [`facets.${field}.keyword`]: item } },
  { term: { [`facets_en.${field}.keyword`]: item } },
];

const clause = (field: string, items: string[]) => ({
  bool: {
    should: items.flatMap((item) => pair(field, item)),
    minimum_should_match: 1,
  },
});

const build = (
  facets: Record<string, string | string[]>,
  mode?: 'and' | 'or-within-facet',
) =>
  SearchUtilsService.buildFilters(
    facets,
    undefined,
    0,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    mode,
  );

describe('SearchUtilsService.buildFilters facet filters', () => {
  it('default (v1): two values in one facet give two clauses, so they AND', () => {
    expect(build({ languages: ['Spanish', 'Polish'] })).toEqual([
      clause('languages', ['Spanish']),
      clause('languages', ['Polish']),
    ]);
  });

  it('or-within-facet: two values in one facet give one clause, so they OR', () => {
    expect(
      build({ languages: ['Spanish', 'Polish'] }, 'or-within-facet'),
    ).toEqual([clause('languages', ['Spanish', 'Polish'])]);
  });

  it('or-within-facet: different facets stay separate clauses, so they AND', () => {
    expect(
      build(
        { languages: ['Spanish', 'Polish'], age_group: 'adult' },
        'or-within-facet',
      ),
    ).toEqual([
      clause('languages', ['Spanish', 'Polish']),
      clause('age_group', ['adult']),
    ]);
  });

  it('or-within-facet: one value builds the same clause as the default', () => {
    expect(build({ languages: 'Spanish' }, 'or-within-facet')).toEqual(
      build({ languages: 'Spanish' }),
    );
  });

  it('or-within-facet: an empty value list builds no clause', () => {
    expect(build({ languages: [] }, 'or-within-facet')).toEqual([]);
  });
});
