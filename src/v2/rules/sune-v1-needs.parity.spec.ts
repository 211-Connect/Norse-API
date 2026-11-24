/* eslint-disable @typescript-eslint/no-require-imports */
import { SUNE_TIER1, SUNE_TIER2 } from './sune-v1-needs';
import { NX } from './sune';

const golden: {
  rows: { query: string; needs: Record<string, number> }[];
} = require('./__fixtures__/golden-scores.json');

describe('sune-v1-needs parity with the golden model output', () => {
  const codes = new Set([...SUNE_TIER1, ...SUNE_TIER2].map((e) => e.code));
  codes.add(NX);

  it('has 91 codes: 16 Tier 1, 74 Tier 2, N-X', () => {
    expect(codes.size).toBe(91);
  });

  it.each(golden.rows.map((r) => [r.query, r] as const))(
    'score keys of "%s" equal the SUNE codes plus N-X',
    (_query, row) => {
      expect(new Set(Object.keys(row.needs))).toEqual(codes);
    },
  );
});
