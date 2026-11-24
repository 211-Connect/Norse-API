/* eslint-disable @typescript-eslint/no-require-imports */
import * as legacy from './index';
import { runCase, snapshotCases } from './snapshot-inputs';

/**
 * V2_QUESTION_RULE_V1=off must behave like development. The snapshot holds the
 * decide + finalize output of origin/development's rules engine (8a05bc6) for
 * every gold-set row and golden-scores row, with and without counts. It was
 * generated ONCE from that code (not from this copy) with
 * scripts/v2-legacy-snapshot.ts; the command is in that file's header.
 */
const snapshot: {
  rules_version: string;
  count: number;
  rows: Record<string, unknown>;
} = require('../__fixtures__/legacy-snapshot.json');

describe('legacy rules engine parity with origin/development', () => {
  const cases = snapshotCases();

  it('covers every gold-set row and golden-scores row, twice', () => {
    expect(cases).toHaveLength(snapshot.count);
    expect(snapshot.count).toBe((459 + 40) * 2);
    expect(Object.keys(snapshot.rows)).toHaveLength(snapshot.count);
  });

  it('the copy reports development rules_version', () => {
    expect(snapshot.rules_version).toBe(legacy.RULES_VERSION);
  });

  it('decide + finalize deep-equal the snapshot for every case', () => {
    const differing = cases
      .filter(
        (c) =>
          JSON.stringify(runCase(legacy as never, c)) !==
          JSON.stringify(snapshot.rows[c.key]),
      )
      .map((c) => c.key);
    expect(differing).toEqual([]);
    // Deep equality too (key order aside).
    for (const c of cases.slice(0, 50)) {
      expect(runCase(legacy as never, c)).toEqual(snapshot.rows[c.key]);
    }
  });
});
