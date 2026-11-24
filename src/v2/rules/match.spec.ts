import {
  MATCH,
  MatchHit,
  NameCandidate,
  capsTokens,
  genericName,
  matchFromName,
  matchFromShares,
  matchOf,
  nameHead,
  nameMatch,
  orgShare,
  queryTokens,
  textShare,
  topOrgBack,
  topOrgShare,
  withinOneEdit,
  wordCoverage,
  wordsHeld,
  topicPhrase,
} from './match';

const hit = (org: string | null, text = ''): MatchHit => ({
  org_name: org,
  text: text.toLowerCase(),
});
describe('orgShare', () => {
  it("matches 'ymca' to org 'YMCA of Greater Seattle'", () => {
    expect(orgShare(['ymca'], [hit('YMCA of Greater Seattle')])).toBe(1);
  });
  it("matches an acronym: 'hra' to 'Health Resource Agency'; stop words skipped", () => {
    expect(orgShare(['hra'], [hit('Health Resource Agency')])).toBe(1);
    expect(orgShare(['hra'], [hit('Health and Resource of Agency')])).toBe(1);
  });
  it("matches 'dshs' to 'Department of Social and Health Services' (function words skipped only)", () => {
    expect(
      orgShare(['dshs'], [hit('Department of Social and Health Services')]),
    ).toBe(1);
  });
  it('matches a prefix of 4+ characters only', () => {
    expect(orgShare(['sea'], [hit('Seattle Org')])).toBe(0);
    expect(orgShare(['seat'], [hit('Seattle Org')])).toBe(1);
  });
  it('counts hits without an org as no match; divides by all hits', () => {
    expect(
      orgShare(['ymca'], [hit('YMCA'), hit(null), hit('Other')]),
    ).toBeCloseTo(1 / 3);
  });
  it('is 0 for no query tokens or no hits', () => {
    expect(orgShare([], [hit('YMCA')])).toBe(0);
    expect(orgShare(['a'], [hit('A')])).toBe(0);
    expect(orgShare(['ymca'], [])).toBe(0);
  });
});

describe('topOrgShare', () => {
  it('is the largest per-org count of matching hits over all hits', () => {
    const hits = [hit('YMCA A'), hit('YMCA A'), hit('YMCA B'), hit('Other')];
    expect(topOrgShare(['ymca'], hits)).toBe(0.5);
  });
  it('counts exact org_name strings, not the match', () => {
    const hits = [hit('YMCA A'), hit('ymca a')];
    expect(topOrgShare(['ymca'], hits)).toBe(0.5);
  });
  it('is 0 for no match, no query tokens or no hits', () => {
    expect(topOrgShare(['ymca'], [hit('Other'), hit(null)])).toBe(0);
    expect(topOrgShare([], [hit('YMCA')])).toBe(0);
    expect(topOrgShare(['ymca'], [])).toBe(0);
  });
});

describe('textShare', () => {
  it('matches every word in the hit text, with a stem tolerance of 2', () => {
    expect(
      textShare(['rent', 'help'], [hit(null, 'rental help program')]),
    ).toBe(1);
    expect(textShare(['rent', 'help'], [hit(null, 'food pantry')])).toBe(0);
  });
  it('is 0 for no query tokens', () => {
    expect(textShare([], [hit(null, 'anything')])).toBe(0);
  });
});

const m = (hits: MatchHit[], words: string[] = ['ymca']) =>
  matchOf({ words, hits });

describe('matchFromShares', () => {
  const shares = {
    words: ['ymca'],
    hit_count: 20,
    org_share: 0,
    top_org_share: 0,
    top_org_back: 1,
    text_share: 1,
    words_held: true,
    named: false,
    generic: false,
  };
  it('MATCH constants', () => {
    expect(MATCH.orgShareMin).toBe(0.5);
    expect(MATCH.topOrgShareMin).toBe(0.45);
    expect(MATCH.textShareMin).toBe(0.2);
    expect(MATCH).toMatchObject({
      nameBackMin: 0.6,
      topOrgBackMin: 0.5,
      genericMinHolders: 5,
      genericNameShareMax: 0.5,
      longQueryMinWords: 3,
      longHeldShareMin: 0.5,
      nameLookupSize: 5,
    });
  });
  it('no query tokens or no hits: spread (no claim)', () => {
    expect(matchFromShares({ ...shares, words: [] })).toBe('spread');
    expect(matchFromShares({ ...shares, words: ['a'] })).toBe('spread');
    expect(matchFromShares({ ...shares, hit_count: 0, text_share: 0 })).toBe(
      'spread',
    );
  });
  it('concentrated: org share 0.5 and one-org share 0.45 (boundaries)', () => {
    const c = { ...shares, org_share: 0.5, top_org_share: 0.45 };
    expect(matchFromShares(c)).toBe('concentrated');
    expect(matchFromShares({ ...c, org_share: 0.49 })).toBe('spread');
    expect(matchFromShares({ ...c, top_org_share: 0.44 })).toBe('spread');
  });
  it('none: the words are not held; spread when held', () => {
    expect(matchFromShares({ ...shares, words_held: false })).toBe('none');
    expect(matchFromShares({ ...shares, words_held: true })).toBe('spread');
  });
  it('named and not generic: concentrated; generic vetoes the name', () => {
    expect(matchFromShares({ ...shares, named: true })).toBe('concentrated');
    expect(matchFromShares({ ...shares, named: true, generic: true })).toBe(
      'spread',
    );
  });
  it('shares need the top org to cover the query (top_org_back >= 0.5)', () => {
    const c = { ...shares, org_share: 0.5, top_org_share: 0.45 };
    expect(matchFromShares({ ...c, top_org_back: 0.5 })).toBe('concentrated');
    expect(matchFromShares({ ...c, top_org_back: 0.49 })).toBe('spread');
  });
});

describe('matchOf', () => {
  it('names null or undefined: named is false', () => {
    expect(matchOf({ words: ['ymca'], hits: [hit('Other')] }).named).toBe(
      false,
    );
    expect(
      matchOf({ words: ['ymca'], hits: [hit('Other')], names: null }).named,
    ).toBe(false);
  });
  it('named candidates decide concentrated and give the org ids', () => {
    const r = matchOf({
      words: ['compass', 'housing'],
      hits: [hit('Other', 'food')],
      names: [cand('o1', 'Compass Housing Alliance')],
    });
    expect(r.named).toBe(true);
    expect(r.value).toBe('concentrated');
    expect(r.named_org_ids).toEqual(['o1']);
  });
  it('not named: named_org_ids is empty', () => {
    const r = matchOf({
      words: ['ymca'],
      hits: [hit('YMCA A', 'ymca')],
      names: [],
    });
    expect(r.named_org_ids).toEqual([]);
  });
  it('concentrated: one org holds most hits', () => {
    const r = m([
      ...Array.from({ length: 18 }, () => hit('YMCA of Greater Seattle')),
      hit('Other Org'),
      hit(null),
    ]);
    expect(r.top_org_share).toBeCloseTo(0.9);
    expect(r.value).toBe('concentrated');
  });
  it('concentrated: several words (salvation army)', () => {
    expect(m([hit('The Salvation Army')], ['salvation', 'army']).value).toBe(
      'concentrated',
    );
  });
  it("'police' over 10 different police departments (share 1.0, top 0.1) is spread", () => {
    const hits = Array.from({ length: 10 }, (_, i) =>
      hit(`City ${i} Police Department`, 'police'),
    );
    const r = m(hits, ['police']);
    expect(r.org_share).toBe(1);
    expect(r.top_org_share).toBeCloseTo(0.1);
    expect(r.value).toBe('spread');
  });
  it('spread: text share at least 0.1', () => {
    expect(m([hit('Other', 'portico clinic')], ['portico']).value).toBe(
      'spread',
    );
  });
  it('none: no hit holds the words', () => {
    expect(m([hit('Other', 'food pantry')], ['seattle']).value).toBe('none');
  });
  it('no hits: spread', () => {
    expect(m([]).value).toBe('spread');
  });
});

describe('request words and ZIP codes (grid match fixes)', () => {
  const food = hit('Some Org', 'food pantry and housing help');
  it("'i need food and housing': textShare ignores 'i', 'need'", () => {
    expect(textShare(['need', 'food', 'housing'], [food])).toBe(1);
    expect(textShare(['i', 'need', 'food', 'housing'], [food])).toBe(1);
  });
  it("'i need food and housing': 'i', 'need' and 'and' do not lower textShare", () => {
    const both = hit('Org A', 'food and housing help');
    const noAnd = hit('Org B', 'food housing');
    const words = ['i', 'need', 'food', 'and', 'housing'];
    expect(textShare(words, [noAnd])).toBe(1);
    expect(textShare(words, [both, noAnd])).toBe(1);
    expect(
      textShare(words, [hit('Org C', 'food housing'), hit('X', 'taxes')]),
    ).toBe(0.5);
  });
  it("'i need food and housing' is not match none when hits hold food or housing", () => {
    const hits = [
      hit('Org A', 'food pantry and housing help'),
      hit('Org B', 'food bank'),
      hit('Org C', 'housing voucher'),
    ];
    const m = matchOf({ words: ['i', 'need', 'food', 'and', 'housing'], hits });
    expect(m.text_share).toBeGreaterThan(0);
    expect(m.value).not.toBe('none');
  });
  it('a query of request words only makes no claim (spread)', () => {
    expect(textShare(['help'], [food])).toBe(0);
    expect(
      matchFromShares({
        words: ['need', 'help'],
        hit_count: 20,
        org_share: 0,
        top_org_share: 0,
        top_org_back: 0,
        text_share: 0,
        words_held: false,
        named: false,
        generic: false,
      }),
    ).toBe('spread');
  });
  it('a ZIP-only query makes no claim: browse, not none (no R5 notice)', () => {
    expect(
      matchOf({ words: ['98101'], hits: [hit('Org', 'seattle food')] }).value,
    ).toBe('spread');
  });
  it("a ZIP next to a word: the word decides ('food 98101')", () => {
    expect(
      matchOf({ words: ['food', '98101'], hits: [hit('Org', 'food bank')] })
        .text_share,
    ).toBe(1);
    expect(
      matchOf({ words: ['covid', '98101'], hits: [hit('Org', 'food bank')] })
        .value,
    ).toBe('none');
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
    expect(r).toEqual({
      named: true,
      org_ids: ['1'],
      name: 'Compass Housing Alliance',
    });
  });
  it('advocate: not named (three different heads)', () => {
    expect(
      run('advocate', [
        cand('1', 'Advocates for Children'),
        cand('2', 'LAW Advocates'),
        cand('3', 'Patient Advocate Foundation'),
      ]).named,
    ).toBe(false);
  });
  it('dshs: named by the caps token', () => {
    expect(
      run('dshs', [cand('1', 'DSHS Community Services Offices')]).named,
    ).toBe(true);
  });
  it('food bank: not named (Auburn / Sequim / Mukilteo)', () => {
    expect(
      run('food bank', [
        cand('1', 'Auburn Food Bank'),
        cand('2', 'Sequim Food Bank'),
        cand('3', 'Mukilteo Food Bank'),
      ]).named,
    ).toBe(false);
  });
  it('red cross (WA): named, regions with the same head word', () => {
    const r = run('red cross', [
      cand('1', 'American Red Cross, Northwest Region'),
      cand('2', 'American Red Cross Cascades Region'),
      cand('3', 'American Red Cross Serving King County'),
      cand('4', 'American Red Cross of the Greater Inland Northwest'),
      cand('5', 'American Red Cross, Northwest Washington Chapter'),
    ]);
    expect(r.named).toBe(true);
    expect(r.org_ids).toEqual(['1', '4', '5']);
  });
  it('salvation army + Salvation Army Longview: named', () => {
    expect(
      run('salvation army', [cand('1', 'Salvation Army Longview')]).named,
    ).toBe(true);
  });
  it('police: not named (two cities)', () => {
    expect(
      run('police', [
        cand('1', 'SeaTac Police Department'),
        cand('2', 'Sequim Police Department'),
      ]).named,
    ).toBe(false);
  });
  it("ymca + 'Tri Town YMCA' with alternate 'YMCA': named", () => {
    expect(run('ymca', [cand('1', 'Tri Town YMCA', ['YMCA'])]).named).toBe(
      true,
    );
  });
  it('empty tokens or no candidates: not named', () => {
    expect(run('a', [cand('1', 'A Org')])).toEqual({
      named: false,
      org_ids: [],
      name: null,
    });
    expect(run('ymca', []).named).toBe(false);
  });
  it('a prefix match wins over others', () => {
    const r = run('compass housing', [
      cand('1', 'Friends of Compass Housing'),
      cand('2', 'Compass Housing Alliance'),
    ]);
    expect(r.org_ids).toEqual(['2']);
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
    expect(textShare(w, hits)).toBe(0);
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

describe('generic word veto and top org back coverage', () => {
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
  it("'police' with top org 'Chicago Police Department': back 1/3", () => {
    const hits = [hit('Chicago Police Department', 'police')];
    expect(topOrgBack(['police'], hits)).toBeCloseTo(1 / 3);
  });
  it('topOrgBack: 0 for no match, 1 for a caps token', () => {
    expect(topOrgBack(['police'], [hit('Other')])).toBe(0);
    expect(topOrgBack(['dshs'], [hit('DSHS Community Services')])).toBe(1);
  });
});

describe('matchFromName (the name owner decides the name claim)', () => {
  const hits = [hit('Other One', 'swim lessons'), hit('Other Two', 'swim')];
  const nm = (
    strength: 'org' | 'service' | 'none',
    over: { vetoed?: boolean; out_of_radius?: boolean | null } = {},
  ) => ({ strength, vetoed: false, out_of_radius: null, ...over });
  const run = (words: string[], h: MatchHit[], name: ReturnType<typeof nm>) =>
    matchFromName({ words, hits: h, name });

  it('org strength, not vetoed, not out of radius: concentrated', () => {
    expect(run(['compass'], hits, nm('org')).value).toBe('concentrated');
    expect(
      run(['compass'], hits, nm('org', { out_of_radius: false })).value,
    ).toBe('concentrated');
  });
  it('vetoed or out of radius: not concentrated (spread when the words are held)', () => {
    expect(run(['swim'], hits, nm('org', { vetoed: true })).value).toBe(
      'spread',
    );
    expect(run(['swim'], hits, nm('org', { out_of_radius: true })).value).toBe(
      'spread',
    );
  });
  it('words not held: none', () => {
    expect(run(['zzzz'], hits, nm('org', { vetoed: true })).value).toBe('none');
  });
  it('service or no strength never concentrates', () => {
    expect(run(['swim'], hits, nm('service')).value).toBe('spread');
    expect(run(['swim'], hits, nm('none')).value).toBe('spread');
  });
  it('no query tokens or no hits: spread', () => {
    expect(run(['i', 'need'], hits, nm('org')).value).toBe('spread');
    expect(run(['compass'], [], nm('org')).value).toBe('spread');
  });
  it('reads only the name: shares are 0, generic is the veto, named is org strength', () => {
    const r = run(['swim'], hits, nm('org', { vetoed: true }));
    expect(r.org_share).toBe(0);
    expect(r.top_org_share).toBe(0);
    expect(r.top_org_back).toBe(0);
    expect(r.generic).toBe(true);
    expect(r.named).toBe(true);
    expect(r.named_org_ids).toEqual([]);
    expect(run(['swim'], hits, nm('service')).named).toBe(false);
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
