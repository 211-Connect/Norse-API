import { stripEnrichment, SUNE_ENRICHMENT_FIELDS } from './enrichment-fields';

describe('stripEnrichment', () => {
  const source = {
    name: 'Shelter',
    sune_needs: ['N-HOU'],
    sune_need_weights: { 'N-HOU': 0.8 },
    sune_scorecard_version: 'v1',
  };

  it('removes all enrichment fields and keeps the others', () => {
    const result = stripEnrichment(source);
    expect(result).toEqual({ name: 'Shelter' });
    for (const f of SUNE_ENRICHMENT_FIELDS)
      expect(result).not.toHaveProperty(f);
  });

  it('does not mutate the input', () => {
    stripEnrichment(source);
    expect(source.sune_needs).toEqual(['N-HOU']);
    expect(source.sune_scorecard_version).toBe('v1');
  });

  it('returns undefined for undefined input', () => {
    expect(stripEnrichment(undefined)).toBeUndefined();
  });
});
