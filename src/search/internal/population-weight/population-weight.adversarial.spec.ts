import { readFileSync } from 'fs';
import { join } from 'path';
import { applyPopulationWeight } from './population-weight';

/**
 * ISS-2693 adversarial set (PR #299, run of 2026-11-17, language rows left
 * out). Each row is one query against one code. `expected` is the tester's
 * call: "zero" (the code must lose its boost) or "keep". `status`:
 *  - assert: the rule must give `expected` (every row that passed, plus every
 *    row the second pass fixed);
 *  - open: a known miss or a judgment call; listed, not asserted.
 * `changed` rows were PASS in the first run and flip on purpose in the second
 * pass (the possessive pattern is gone); `expected` holds the new call.
 */
interface Row {
  cat: string;
  query: string;
  code: string;
  expected: 'zero' | 'keep';
  reason: string;
  status: 'assert' | 'open';
  note?: string;
}

const rows: Row[] = JSON.parse(
  readFileSync(
    join(__dirname, '__fixtures__', 'adversarial-cases.json'),
    'utf8',
  ),
);

const CODES: Record<string, ReturnType<typeof entry>> = {
  men: entry('YS-5000.5000', 'Men', ['Male', 'Males', 'Gentlemen']),
  women: entry('YS-5000.8000', 'Women', ['Female', 'Ladies']),
  vets: entry('YN-1000.1000', 'Veterans', ['Military', 'Service members']),
  older: entry('YB-1000.1000', 'Older Adults', [
    'Seniors',
    'Elders',
    'Elderly',
  ]),
  youth: entry('YB-2000.1000', 'Youth', ['Teens']),
  cmen: entry('BH-1800.8500 * YS-5000.5000', 'Homeless Shelter * Men', []),
  colder: entry('LH-3000 * YB-1000.1000', 'Housing * Older Adults', []),
};

function entry(code: string, name: string, useReferences: string[]) {
  return { code, name, score: 0.8, useReferences };
}

describe('population weight: adversarial set (ISS-2693, PR #299)', () => {
  const asserted = rows.filter((r) => r.status === 'assert');

  it.each(asserted.map((r) => [r.cat, r.query, r.code, r.expected, r]))(
    '[%s] "%s" (%s) -> %s',
    (_cat, _query, _code, _expected, row) => {
      const r = row as Row;
      const out = applyPopulationWeight([{ ...CODES[r.code] }], r.query, 'en');
      expect(out[0].score).toBe(r.expected === 'keep' ? 0.8 : 0);
    },
  );

  it('lists the open rows (not asserted)', () => {
    const open = rows.filter((r) => r.status === 'open');
    expect(open.every((r) => r.note || r.reason)).toBe(true);
  });
});
