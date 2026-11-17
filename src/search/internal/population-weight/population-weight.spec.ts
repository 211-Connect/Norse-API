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
    ['children', 'child'],
    ['child', 'child'],
    ['families', 'family'],
    ['human', 'human'],
    ['class', 'class'],
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

describe('tokenize, shared with word rarity', () => {
  it('folds accents instead of splitting the word', () => {
    expect(tokenize('niñas y niños')).toEqual(new Set(['nina', 'nino']));
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

describe('groupWords: function words never name a group', () => {
  it('drops function words from use references', () => {
    expect([...groupWords('Men', ['Persons Who Are Male'])].sort()).toEqual(
      ['male', 'men', 'person'].sort(),
    );
  });
});

describe('applyPopulationWeight', () => {
  const list = () => [
    code('YS-5000.5000', 'Men'),
    code('BH-1800.8500 * YS-5000.5000', 'Homeless Shelter * Men', 0.7),
    code('BH-1800.1500-100', 'Domestic Violence Shelters', 0.6),
  ];

  it('zeroes Men codes when the query does not name the group', () => {
    const out = applyPopulationWeight(list(), 'my boyfriend hits me', 'en');
    expect(out.map((p) => p.score)).toEqual([0, 0, 0.6]);
  });

  it.each(['shelter for men', 'mens shelter'])('keeps Men for "%s"', (q) => {
    const input = list();
    expect(applyPopulationWeight(input, q, 'en')).toEqual(input);
  });

  it('keeps an age code when a use reference names the group', () => {
    const input = [code('YB-1000.1000', 'Older Adults', 0.8, ['Seniors'])];
    expect(applyPopulationWeight(input, 'food help for seniors', 'en')).toEqual(
      input,
    );
  });

  it('zeroes an age code with no use references (known limit)', () => {
    const input = [code('YB-1000.1000', 'Older Adults')];
    expect(
      applyPopulationWeight(input, 'food help for seniors', 'en')[0].score,
    ).toBe(0);
  });

  it('a function word shared with a use reference does not keep the boost', () => {
    const input = [code('YS-5000.5000', 'Men', 0.8, ['Persons Who Are Male'])];
    expect(applyPopulationWeight(input, 'who can help me', 'en')[0].score).toBe(
      0,
    );
  });

  it.each(['food for my child', 'food for my children'])(
    'keeps Children for "%s"',
    (q) => {
      const input = [code('YB-9500.1500', 'Children')];
      expect(applyPopulationWeight(input, q, 'en')).toEqual(input);
    },
  );

  it('keeps a military code named in the query', () => {
    const input = [code('YN-1000.1000', 'Veterans')];
    expect(applyPopulationWeight(input, 'veterans housing', 'en')).toEqual(
      input,
    );
  });

  it('keeps length and order, returns a new array, does not mutate', () => {
    const input = list();
    const out = applyPopulationWeight(input, 'my boyfriend hits me', 'en');
    expect(out).not.toBe(input);
    expect(out.map((p) => p.code)).toEqual(input.map((p) => p.code));
    expect(input[0].score).toBe(0.8);
  });

  it('returns the input unchanged for an empty or undefined query', () => {
    const input = list();
    expect(applyPopulationWeight(input, '', 'en')).toEqual(input);
    expect(applyPopulationWeight(input, undefined, 'en')).toEqual(input);
  });

  it('multiplies by a given weight', () => {
    const out = applyPopulationWeight(list(), 'my boyfriend hits me', 'en', {
      weight: 0.25,
    });
    expect(out[0].score).toBeCloseTo(0.2);
    expect(out[2].score).toBe(0.6);
  });
});

describe('applyPopulationWeight: asking for the group, not mentioning it', () => {
  const men = () => [code('YS-5000.5000', 'Men')];
  const compound = () => [
    code('BH-1800.8500 * YS-5000.5000', 'Homeless Shelter * Men', 0.9),
  ];

  // David's review queries (PR #299): the group is an actor, not the ask.
  it.each([
    'my boyfriend hits me',
    'a man keeps hitting me',
    'my ex is a violent man',
    'shelters not for men',
    'a man hit me, need a shelter',
  ])('zeroes Men for "%s"', (q) => {
    expect(applyPopulationWeight(men(), q, 'en')[0].score).toBe(0);
    expect(applyPopulationWeight(compound(), q, 'en')[0].score).toBe(0);
  });

  it.each([
    'shelter for men',
    "men's shelter",
    'mens shelter',
    'men only housing',
    'a place for homeless men',
    'i am a man and my boyfriend hits me',
    'women and men shelter',
  ])('keeps Men for the request "%s"', (q) => {
    expect(applyPopulationWeight(men(), q, 'en')[0].score).toBe(0.8);
  });

  it.each([
    'not for men',
    'women shelter no men',
    "i don't want men around",
    'shelter other than men',
    'a shelter that is not a place for men',
  ])('negation: zeroes Men for "%s"', (q) => {
    expect(applyPopulationWeight(men(), q, 'en')[0].score).toBe(0);
  });

  it('a negator far from the mention does not cancel it', () => {
    const q = 'i have no money, need a men shelter';
    expect(applyPopulationWeight(men(), q, 'en')[0].score).toBe(0.8);
  });

  it('keeps an age code for "senior housing" and "for seniors"', () => {
    const input = [code('YB-1000.1000', 'Older Adults', 0.8, ['Seniors'])];
    for (const q of ['senior housing', 'help for seniors', 'we are seniors']) {
      expect(applyPopulationWeight(input, q, 'en')).toEqual(input);
    }
  });

  it('zeroes Older Adults for "my older brother hits me"', () => {
    const input = [code('YB-1000.1000', 'Older Adults', 0.8, ['Seniors'])];
    const q = 'my older brother hits me';
    expect(applyPopulationWeight(input, q, 'en')[0].score).toBe(0);
  });

  it.each([
    'my veteran husband has ptsd',
    'my veteran husband hits me',
    'my military husband threatens me',
  ])('a possessive does not keep Veterans: "%s"', (q) => {
    const input = [code('YN-1000.1000', 'Veterans', 0.8, ['Military'])];
    expect(applyPopulationWeight(input, q, 'en')[0].score).toBe(0);
  });

  it.each([
    'a man only hit me once',
    'only men hit me',
    'men only hit me when drunk',
    'for a man hit me',
    'for the man who hit me, shelter',
    'i am a woman, men hit me',
    'i am a woman hiding from a man',
  ])('zeroes Men for the actor query "%s"', (q) => {
    expect(applyPopulationWeight(men(), q, 'en')[0].score).toBe(0);
  });

  it.each(['men only shelter', 'men-only shelter', 'i am a very old man'])(
    'keeps Men for "%s"',
    (q) => {
      expect(applyPopulationWeight(men(), q, 'en')[0].score).toBe(0.8);
    },
  );

  it.each([
    'women and children',
    'women and children shelter',
    'children and women',
    'help for women & children',
  ])('keeps Women for "%s"', (q) => {
    const women = [code('YS-5000.8000', 'Women')];
    expect(applyPopulationWeight(women, q, 'en')[0].score).toBe(0.8);
  });

  it('"not for women and children" still zeroes Women', () => {
    const women = [code('YS-5000.8000', 'Women')];
    const q = 'not for women and children';
    expect(applyPopulationWeight(women, q, 'en')[0].score).toBe(0);
  });

  it('"veterans only" keeps Veterans (only still counts for non-sex codes)', () => {
    const input = [code('YN-1000.1000', 'Veterans')];
    expect(applyPopulationWeight(input, 'veterans only', 'en')).toEqual(input);
  });

  it('a possessive does not keep a sex code: "my man hits me"', () => {
    expect(applyPopulationWeight(men(), 'my man hits me', 'en')[0].score).toBe(
      0,
    );
  });

  it('keeps Women for "women and men shelter" through the group chain', () => {
    const input = [code('YS-5000.8000', 'Women'), code('YS-5000.5000', 'Men')];
    const out = applyPopulationWeight(input, 'women and men shelter', 'en');
    expect(out.map((p) => p.score)).toEqual([0.8, 0.8]);
  });
});

describe('applyPopulationWeight: other languages', () => {
  const input = [
    code('YS-5000.5000', 'Men'),
    code('BH-1800.8500 * YS-5000.5000', 'Homeless Shelter * Men', 0.7),
  ];
  it.each(['es', 'es-MX', 'fr', 'zh-Hans'])(
    'does nothing for language %s: no boost, no zero',
    (lang) => {
      expect(
        applyPopulationWeight(input, 'albergue para hombres', lang),
      ).toEqual(input);
      expect(applyPopulationWeight(input, 'mi novio me pega', lang)).toEqual(
        input,
      );
    },
  );
  it('a missing language means en', () => {
    const out = applyPopulationWeight(input, 'mi novio me pega', undefined);
    expect(out.map((p) => p.score)).toEqual([0, 0]);
  });
});

describe('applyPopulationWeight: compound codes (c1 vs c2)', () => {
  const list = () => [
    code('BH-1800.8500 * YS-5000.5000', 'Homeless Shelter * Men', 0.9),
    code('LH-3000 * YB-1000.1000', 'Health Screening * Older Adults', 0.8),
    code('YS-5000.5000', 'Men', 0.7),
  ];
  const q = 'health screening for my mom';
  it('c1 (compound weight 0): the whole compound is zeroed', () => {
    const out = applyPopulationWeight(list(), q, 'en', { compoundWeight: 0 });
    expect(out.map((p) => p.score)).toEqual([0, 0, 0]);
  });
  it('c2 (compound weight 0.5): the service part keeps half, a plain identity code is still zeroed', () => {
    const out = applyPopulationWeight(list(), q, 'en', { compoundWeight: 0.5 });
    expect(out[0].score).toBeCloseTo(0.45);
    expect(out[1].score).toBeCloseTo(0.4);
    expect(out[2].score).toBe(0);
  });
  it('a compound whose identity part is requested keeps its full score in both', () => {
    for (const compoundWeight of [0, 0.5]) {
      const out = applyPopulationWeight(list(), 'shelter for men', 'en', {
        compoundWeight,
      });
      expect(out[0].score).toBe(0.9);
    }
  });
});
