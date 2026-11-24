import {
  MatchHit,
  NameCandidate,
  capsTokens,
  genericName,
  holdsAllWords,
  matchValue,
  matchOf,
  nameHead,
  nameMatch,
  queryTokens,
  withinOneEdit,
  wordCoverage,
  wordsHeld,
  topicPhrase,
} from './match';

const hit = (org: string | null, text = ''): MatchHit => ({
  org_name: org,
  text: text.toLowerCase(),
});
describe('holdsAllWords', () => {
  it('a word, or the start of one with 4+ letters', () => {
    expect(holdsAllWords(['seat'], 'Seattle Org')).toBe(true);
    expect(holdsAllWords(['sea'], 'Seattle Org')).toBe(false);
    expect(holdsAllWords(['food', 'bank'], 'Ballard Food Bank')).toBe(true);
    expect(holdsAllWords(['food', 'bank'], 'Ballard Food Pantry')).toBe(false);
  });
  it('no query token: false', () => {
    expect(holdsAllWords([], 'YMCA')).toBe(false);
    expect(holdsAllWords(['a'], 'A')).toBe(false);
  });
});

const m = (hits: MatchHit[], words: string[] = ['ymca'], named = false) =>
  matchOf({ words, hits, named });

describe('matchOf', () => {
  it('named: concentrated, whatever the hits hold', () => {
    expect(m([hit('A', 'food')], ['ymca'], true)).toBe('concentrated');
  });
  it('not named: spread when the words are held, else none', () => {
    expect(m([hit('YMCA', 'ymca swim')])).toBe('spread');
    expect(m([hit('YMCA', 'swim')])).toBe('none');
  });
  it('one org that fills the page is not a name by itself', () => {
    const page = Array.from({ length: 20 }, () => hit('YMCA', 'ymca swim'));
    expect(m(page)).toBe('spread');
  });
  it('no hits: spread, unless named; no query token: spread', () => {
    expect(m([], ['ymca'])).toBe('spread');
    expect(m([], ['ymca'], true)).toBe('concentrated');
    expect(m([hit('A', 'x')], ['i', 'need'], true)).toBe('spread');
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
    expect(wordCoverage(['ninos'], [hit(null, 'ayuda para niños')])).toEqual([
      1,
    ]);
    expect(wordCoverage(['продукты'], [hit(null, 'продукты питания')])).toEqual(
      [1],
    );
    expect(matchValue({ ...v, hit_count: 0 })).toBe('spread');
  });
});

describe('request words and ZIP codes (grid match fixes)', () => {
  const food = hit('Some Org', 'food pantry and housing help');
  it("'i need food and housing': 'i', 'need' and 'and' are not read", () => {
    const words = ['i', 'need', 'food', 'and', 'housing'];
    expect(wordCoverage(words, [food])).toEqual([1, 1]);
    expect(wordCoverage(words, [hit('Org B', 'food housing')])).toEqual([1, 1]);
  });
  it("'i need food and housing' is not match none when hits hold food or housing", () => {
    const hits = [
      hit('Org A', 'food pantry and housing help'),
      hit('Org B', 'food bank'),
      hit('Org C', 'housing voucher'),
    ];
    expect(m(hits, ['i', 'need', 'food', 'and', 'housing'])).toBe('spread');
  });
  it('a query of request words only makes no claim (spread)', () => {
    expect(m([food], ['need', 'help'])).toBe('spread');
  });
  it('a ZIP-only query makes no claim: browse, not none (no R5 notice)', () => {
    expect(m([hit('Org', 'seattle food')], ['98101'])).toBe('spread');
  });
  it("a ZIP next to a word: the word decides ('food 98101')", () => {
    expect(m([hit('Org', 'food bank')], ['food', '98101'])).toBe('spread');
    expect(m([hit('Org', 'food bank')], ['covid', '98101'])).toBe('none');
  });
});

const cand = (
  id: string,
  name: string,
  alternate_names: string[] = [],
): NameCandidate => ({ id, name, alternate_names });

describe('name helpers', () => {
  it('nameHead cuts at the first separator, drops function words', () => {
    expect(nameHead('American Red Cross, Northwest Region')).toEqual([
      'american',
      'red',
      'cross',
    ]);
    expect(nameHead('YMCA of Greater Seattle')).toEqual(['ymca']);
    expect(nameHead("Mary's House Inc")).toEqual(['mary']);
    expect(nameHead('Red Red Cross')).toEqual(['red', 'cross']);
  });
  it('capsTokens: none for an all-caps name', () => {
    expect(capsTokens('CENTREVILLE POLICE DEPARTMENT')).toEqual([]);
    expect(capsTokens('DSHS Community Services Offices')).toEqual(['dshs']);
  });
  it('queryTokens is exported', () => {
    expect(queryTokens(['i', 'need', 'food', '98101'])).toEqual(['food']);
  });
});

describe('nameMatch', () => {
  const run = (q: string, c: NameCandidate[]) => nameMatch(q.split(' '), c);
  it('compass housing + Compass Housing Alliance: named', () => {
    const r = run('compass housing', [cand('1', 'Compass Housing Alliance')]);
    expect(r).toEqual({ start: true, org_ids: ['1'] });
  });
  it('advocate: not named (three different heads)', () => {
    expect(
      run('advocate', [
        cand('1', 'Advocates for Children'),
        cand('2', 'LAW Advocates'),
        cand('3', 'Patient Advocate Foundation'),
      ]),
    ).toBeNull();
  });
  it('dshs: named by the caps token', () => {
    expect(
      run('dshs', [cand('1', 'DSHS Community Services Offices')]),
    ).toMatchObject({ start: true });
  });
  it('food bank: not named (Auburn / Sequim / Mukilteo)', () => {
    expect(
      run('food bank', [
        cand('1', 'Auburn Food Bank'),
        cand('2', 'Sequim Food Bank'),
        cand('3', 'Mukilteo Food Bank'),
      ]),
    ).toBeNull();
  });
  it('red cross (WA): named, regions with the same head word', () => {
    const r = run('red cross', [
      cand('1', 'American Red Cross, Northwest Region'),
      cand('2', 'American Red Cross Cascades Region'),
      cand('3', 'American Red Cross Serving King County'),
      cand('4', 'American Red Cross of the Greater Inland Northwest'),
      cand('5', 'American Red Cross, Northwest Washington Chapter'),
    ]);
    // '... Cascades Region' is no separator: it is not a short form of this name.
    expect(r).toEqual({ start: false, org_ids: ['1', '3', '4', '5'] });
  });
  it('salvation army + Salvation Army Longview: named', () => {
    expect(
      run('salvation army', [cand('1', 'Salvation Army Longview')]),
    ).toMatchObject({ start: true });
  });
  it('police: not named (two cities)', () => {
    expect(
      run('police', [
        cand('1', 'SeaTac Police Department'),
        cand('2', 'Sequim Police Department'),
      ]),
    ).toBeNull();
  });
  it("ymca + 'Tri Town YMCA' with alternate 'YMCA': named", () => {
    expect(run('ymca', [cand('1', 'Tri Town YMCA', ['YMCA'])])).toMatchObject({
      start: true,
    });
  });
  it('empty tokens or no candidates: not named', () => {
    expect(run('a', [cand('1', 'A Org')])).toBeNull();
    expect(run('ymca', [])).toBeNull();
  });
  it('a prefix match wins over others', () => {
    const r = run('compass housing', [
      cand('1', 'Friends of Compass Housing'),
      cand('2', 'Compass Housing Alliance'),
    ]);
    expect(r?.org_ids).toEqual(['2']);
  });
  it('one name that only holds the words is not a name; two that agree are', () => {
    const one = cand('1', 'Ballard Food Bank');
    expect(run('food bank', [one])).toBeNull();
    // One org stored twice is one name.
    expect(run('food bank', [one, cand('2', 'BALLARD FOOD BANK')])).toBeNull();
    expect(
      run('food bank', [one, cand('2', 'Ballard Food Bank - Annex')]),
    ).toEqual({ start: false, org_ids: ['1', '2'] });
  });
  it("red cross (Seattle, 2 orgs in reach): 'Serving' ends the name head", () => {
    const r = run('red cross', [
      cand('1', 'American Red Cross, Northwest Region'),
      cand('2', 'American Red Cross Serving King County'),
    ]);
    expect(r).toEqual({ start: false, org_ids: ['1', '2'] });
  });
  it('the word order of the query does not matter', () => {
    const c = [cand('1', 'Compass Housing Alliance')];
    expect(run('housing compass', c)).toEqual(run('compass housing', c));
  });
  it('a name that starts with the words is one org', () => {
    expect(run('food bank', [cand('1', 'Food Bank of X')])).toMatchObject({
      start: true,
    });
  });
  it('initials of a name are not read (only caps inside a name are)', () => {
    const dshs = [cand('1', 'Department of Social and Health Services')];
    expect(run('dshs', dshs)).toBeNull();
  });
});

describe('word coverage (typos, long queries)', () => {
  const words = (...t: string[]) => t;
  it('withinOneEdit: insert, delete, substitute, swap', () => {
    expect(withinOneEdit('foood', 'food')).toBe(true);
    expect(withinOneEdit('fod', 'food')).toBe(true);
    expect(withinOneEdit('fuod', 'food')).toBe(true);
    expect(withinOneEdit('fodo', 'food')).toBe(true);
    expect(withinOneEdit('fxxd', 'food')).toBe(false);
  });
  it("'foood bank' holds 'food' (typo)", () => {
    const hits = [hit('x', 'food bank downtown')];
    expect(wordCoverage(['foood', 'bank'], hits)).toEqual([1, 1]);
  });
  it('wordCoverage is [] for no tokens or no hits', () => {
    expect(wordCoverage([], [hit('x', 'a')])).toEqual([]);
    expect(wordCoverage(['food'], [])).toEqual([]);
  });
  it('long query: half food, half housing is held (old AND share is low)', () => {
    const hits = [
      ...Array.from({ length: 10 }, () => hit('x', 'food pantry')),
      ...Array.from({ length: 10 }, () => hit('x', 'housing help')),
    ];
    const w = ['i', 'need', 'food', 'and', 'housing'];
    expect(wordsHeld(wordCoverage(w, hits))).toBe(true);
  });
  it("'compass housing' where no hit holds 'compass': not held", () => {
    const hits = [hit('x', 'housing help'), hit('y', 'housing aid')];
    expect(wordsHeld(wordCoverage(words('compass', 'housing'), hits))).toBe(
      false,
    );
  });
  it('a 4-word query with 1 of 4 words held: not held', () => {
    const hits = [hit('x', 'alpha')];
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

describe('generic word veto', () => {
  it("'veterans': 20 hold it, 7 org names do: generic", () => {
    const hits = [
      ...Array.from({ length: 7 }, (_, i) =>
        hit(`Veterans Org ${i}`, 'veterans help'),
      ),
      ...Array.from({ length: 13 }, (_, i) =>
        hit(`Other ${i}`, 'veterans aid'),
      ),
    ];
    expect(genericName(['veterans'], hits)).toBe(true);
  });
  it("'salvation army' 16 of 16: not generic", () => {
    const hits = Array.from({ length: 16 }, () =>
      hit('Salvation Army', 'salvation army'),
    );
    expect(genericName(['salvation', 'army'], hits)).toBe(false);
  });
  it('fewer than 5 holders: not generic', () => {
    expect(genericName(['x1y'], [hit('Other', 'x1y')])).toBe(false);
  });
});

describe('topicPhrase', () => {
  const terms = [
    'Food Pantries',
    'Food Banks/Food Distribution Warehouses',
    'General Legal Aid',
    'Housing Authorities',
    'Senior Centers',
    'Homeless Shelter',
    'Red Cross Disaster Service Centers',
    'Individual Advocacy * Veterans',
    'Case/Care Management',
  ];
  it.each([
    'food pantry',
    'food bank',
    'legal aid',
    'housing authority',
    'senior center',
    'homeless shelter',
    'veterans',
  ])('%s is a term of the directory', (q) => {
    expect(topicPhrase(q.split(' '), terms)).toBe(true);
  });
  it.each([
    'red cross',
    'ymca',
    'goodwill',
    'compass housing',
    'salvation army',
    'ballard food bank',
    'food',
  ])('%s is not', (q) => {
    expect(topicPhrase(q.split(' '), terms)).toBe(false);
  });
  it('no query word, no term: false', () => {
    expect(topicPhrase(['i', 'need'], terms)).toBe(false);
    expect(topicPhrase(['food'], [])).toBe(false);
    expect(topicPhrase(['food'], [' / '])).toBe(false);
  });
});
