import {
  applyPopulationWeight,
  groupWords,
  identityLabel,
  normalizeToken,
  tokenize,
} from './population-weight';

const code = (
  c: string,
  name: string,
  score = 0.8,
  useReferences?: string[],
) => ({
  code: c,
  name,
  score,
  ...(useReferences ? { useReferences } : {}),
});

describe('normalizeToken', () => {
  it.each([
    ["Men's", 'men'],
    ['man', 'men'],
    ['woman', 'women'],
    ['seniors', 'senior'],
    ['bus', 'bus'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeToken(input)).toBe(expected);
  });
});

describe('tokenize', () => {
  it('splits on non-word characters and normalizes', () => {
    expect([...tokenize("Shelter for Men's beds")].sort()).toEqual(
      ['bed', 'for', 'men', 'shelter'].sort(),
    );
  });
});

describe('identityLabel', () => {
  it('takes the name of a YS code', () => {
    expect(identityLabel('YS-5000.5000', 'Men')).toBe('Men');
  });
  it('takes only the identity part of a compound code', () => {
    expect(
      identityLabel('BH-1800.8500 * YS-5000.5000', 'Homeless Shelter * Men'),
    ).toBe('Men');
  });
  it('returns empty for a non-identity code', () => {
    expect(
      identityLabel('BH-1800.1500-100', 'Domestic Violence Shelters'),
    ).toBe('');
  });
  it('treats the whole code as one part when part counts differ', () => {
    expect(identityLabel('BH-1800.8500 * YS-5000.5000', 'Only One Name')).toBe(
      '',
    );
  });
});

describe('groupWords', () => {
  it('keeps label and use-reference tokens of length >= 3', () => {
    expect(
      [...groupWords('Older Adults', ['Seniors', 'Aged 65'])].sort(),
    ).toEqual(['adult', 'aged', 'older', 'senior'].sort());
  });
});

describe('applyPopulationWeight', () => {
  const list = () => [
    code('YS-5000.5000', 'Men'),
    code('BH-1800.8500 * YS-5000.5000', 'Homeless Shelter * Men', 0.7),
    code('BH-1800.1500-100', 'Domestic Violence Shelters', 0.6),
  ];

  it('zeroes Men codes when the query does not name the group', () => {
    const out = applyPopulationWeight(list(), 'my boyfriend hits me');
    expect(out.map((p) => p.score)).toEqual([0, 0, 0.6]);
  });

  it.each(['shelter for men', 'mens shelter'])('keeps Men for "%s"', (q) => {
    const input = list();
    expect(applyPopulationWeight(input, q)).toEqual(input);
  });

  it('keeps an age code when a use reference names the group', () => {
    const input = [code('YB-1000.1000', 'Older Adults', 0.8, ['Seniors'])];
    expect(applyPopulationWeight(input, 'food help for seniors')).toEqual(
      input,
    );
  });

  it('zeroes an age code with no use references (known limit)', () => {
    const input = [code('YB-1000.1000', 'Older Adults')];
    expect(applyPopulationWeight(input, 'food help for seniors')[0].score).toBe(
      0,
    );
  });

  it('keeps a military code named in the query', () => {
    const input = [code('YN-1000.1000', 'Veterans')];
    expect(applyPopulationWeight(input, 'veterans housing')).toEqual(input);
  });

  it('keeps length and order, returns a new array, does not mutate', () => {
    const input = list();
    const out = applyPopulationWeight(input, 'my boyfriend hits me');
    expect(out).not.toBe(input);
    expect(out.map((p) => p.code)).toEqual(input.map((p) => p.code));
    expect(input[0].score).toBe(0.8);
  });

  it('returns the input unchanged for an empty or undefined query', () => {
    const input = list();
    expect(applyPopulationWeight(input, '')).toEqual(input);
    expect(applyPopulationWeight(input, undefined)).toEqual(input);
  });

  it('multiplies by a given weight', () => {
    const out = applyPopulationWeight(list(), 'my boyfriend hits me', 0.25);
    expect(out[0].score).toBeCloseTo(0.2);
    expect(out[2].score).toBe(0.6);
  });
});
