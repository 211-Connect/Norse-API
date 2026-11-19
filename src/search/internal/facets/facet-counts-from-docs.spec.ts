import {
  facetCountsFromDocs,
  facetSourceFields,
} from './facet-counts-from-docs';

describe('facetCountsFromDocs', () => {
  const aggs = {
    age: { terms: { field: 'facets.age.keyword', size: 2 } },
    label_age_en: {
      terms: { field: 'taxonomy_names.age.en.keyword', size: 1 },
    },
  };

  it('lists the source paths of the terms fields', () => {
    expect(facetSourceFields(aggs)).toEqual([
      'facets.age',
      'taxonomy_names.age.en',
    ]);
  });

  it('counts each document once per value, in Elasticsearch terms order', () => {
    const docs = [
      {
        facets: { age: ['adult', 'senior', 'adult'] },
        taxonomy_names: { age: { en: 'Age' } },
      },
      { facets: { age: 'adult' }, taxonomy_names: { age: [{ en: 'Age' }] } },
      { facets: { age: ['child', 'senior'] } },
      { facets: { age: ['child'] } },
      {},
    ];
    const out = facetCountsFromDocs(aggs, docs);
    // adult 2, child 2, senior 2: ties go by key ascending, size 2.
    expect(out.age.buckets).toEqual([
      { key: 'adult', doc_count: 2 },
      { key: 'child', doc_count: 2 },
    ]);
    expect(out.age.sum_other_doc_count).toBe(2);
    expect(out.label_age_en.buckets).toEqual([{ key: 'Age', doc_count: 2 }]);
  });

  it('reads a dotted key in the source', () => {
    const out = facetCountsFromDocs(aggs, [{ 'facets.age': 'adult' }]);
    expect(out.age.buckets).toEqual([{ key: 'adult', doc_count: 1 }]);
  });

  it('returns empty buckets with no documents', () => {
    expect(facetCountsFromDocs(aggs, []).age).toEqual({
      doc_count_error_upper_bound: 0,
      sum_other_doc_count: 0,
      buckets: [],
    });
  });
});
