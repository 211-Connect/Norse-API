import { matchOf, matchValue, wordCoverage, wordsHeld } from './match';

const m = (texts: string[], words: string[] = ['ymca'], named = false) =>
  matchOf({ words, texts, named });

describe('matchOf', () => {
  it('named: concentrated, whatever the hits hold', () => {
    expect(m(['food'], ['ymca'], true)).toBe('concentrated');
  });
  it('not named: spread when the words are held, else none', () => {
    expect(m(['ymca swim'])).toBe('spread');
    expect(m(['swim'])).toBe('none');
  });
  it('one org that fills the page is not a name by itself', () => {
    const page = Array.from({ length: 20 }, () => 'ymca swim');
    expect(m(page)).toBe('spread');
  });
  it('no hits: spread, unless named; no query token: spread', () => {
    expect(m([], ['ymca'])).toBe('spread');
    expect(m([], ['ymca'], true)).toBe('concentrated');
    expect(m(['x'], ['i', 'need'])).toBe('spread');
  });
  it('matchValue reads the saved measures the same way', () => {
    const v = {
      words: ['ymca'],
      hit_count: 20,
      words_held: false,
      named: false,
    };
    expect(matchValue(v)).toBe('none');
    expect(matchValue({ ...v, words_held: true })).toBe('spread');
    expect(matchValue({ ...v, named: true })).toBe('concentrated');
    expect(wordCoverage(['ninos'], ['ayuda para niños'])).toEqual([1]);
    expect(wordCoverage(['продукты'], ['продукты питания'])).toEqual([1]);
    expect(matchValue({ ...v, hit_count: 0 })).toBe('spread');
  });
});

describe('request words and ZIP codes (grid match fixes)', () => {
  const food = 'food pantry and housing help';
  it("'i need food and housing': 'i', 'need' and 'and' are not read", () => {
    const words = ['i', 'need', 'food', 'and', 'housing'];
    expect(wordCoverage(words, [food])).toEqual([1, 1]);
    expect(wordCoverage(words, ['food housing'])).toEqual([1, 1]);
  });
  it("'i need food and housing' is not match none when hits hold food or housing", () => {
    const hits = [
      'food pantry and housing help',
      'food bank',
      'housing voucher',
    ];
    expect(m(hits, ['i', 'need', 'food', 'and', 'housing'])).toBe('spread');
  });
  it("'necesito comida' is about comida", () => {
    expect(m(['banco de comida'], ['necesito', 'comida'])).toBe('spread');
    expect(m(['banco de comida'], ['ayuda'])).toBe('spread');
    // A claim stands whatever the words are.
    expect(m([], ['ayuda'], true)).toBe('concentrated');
  });
  it.each(
    [
      'necesita comida',
      'necesitan comida',
      'buscamos comida',
      'ayudenme comida',
      'busca comida',
      'buscando comida',
      'quisiera comida',
      'ayudame comida',
      'asistencia comida',
    ].map((q) => [q]),
  )('%p is about comida, however the request is worded', (q) => {
    expect(m(['banco de comida'], q.split(' '))).toBe('spread');
    expect(m(['legal clinic'], q.split(' '))).toBe('none');
  });
  it('a query of request words only makes no claim (spread)', () => {
    expect(m([food], ['need', 'help'])).toBe('spread');
  });
  it('a ZIP-only query makes no claim: browse, not none (no R5 notice)', () => {
    expect(m(['seattle food'], ['98101'])).toBe('spread');
  });
  it("a ZIP next to a word: the word decides ('food 98101')", () => {
    expect(m(['food bank'], ['food', '98101'])).toBe('spread');
    expect(m(['food bank'], ['covid', '98101'])).toBe('none');
  });
});

describe('word coverage (typos, long queries)', () => {
  const words = (...t: string[]) => t;
  it("'foood bank' holds 'food' (typo)", () => {
    const hits = ['food bank downtown'];
    expect(wordCoverage(['foood', 'bank'], hits)).toEqual([1, 1]);
  });
  it('wordCoverage is [] for no tokens or no hits', () => {
    expect(wordCoverage([], ['a'])).toEqual([]);
    expect(wordCoverage(['food'], [])).toEqual([]);
  });
  it('long query: half food, half housing is held (old AND share is low)', () => {
    const hits = [
      ...Array.from({ length: 10 }, () => 'food pantry'),
      ...Array.from({ length: 10 }, () => 'housing help'),
    ];
    const w = ['i', 'need', 'food', 'and', 'housing'];
    expect(wordsHeld(wordCoverage(w, hits))).toBe(true);
  });
  it("'compass housing' where no hit holds 'compass': not held", () => {
    const hits = ['housing help', 'housing aid'];
    expect(wordsHeld(wordCoverage(words('compass', 'housing'), hits))).toBe(
      false,
    );
  });
  it('a 4-word query with 1 of 4 words held: not held', () => {
    const hits = ['alpha'];
    expect(
      wordsHeld(wordCoverage(words('alpha', 'bravo', 'carol', 'delta'), hits)),
    ).toBe(false);
  });
  it('wordsHeld: empty is true; short query uses the minimum', () => {
    expect(wordsHeld([])).toBe(true);
    expect(wordsHeld([0.2, 0.19])).toBe(false);
    expect(wordsHeld([0.2, 0.5])).toBe(true);
  });
});
