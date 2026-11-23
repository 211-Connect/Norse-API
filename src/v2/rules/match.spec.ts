import {
  MATCH,
  MatchHit,
  matchFromShares,
  matchOf,
  orgShare,
  textShare,
  topOrgShare,
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
    text_share: 1,
  };
  it('MATCH constants', () => {
    expect(MATCH.orgShareMin).toBe(0.5);
    expect(MATCH.topOrgShareMin).toBe(0.45);
    expect(MATCH.textShareMin).toBe(0.1);
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
  it('none: text share below 0.1; spread from 0.1', () => {
    expect(matchFromShares({ ...shares, text_share: 0.09 })).toBe('none');
    expect(matchFromShares({ ...shares, text_share: 0.1 })).toBe('spread');
  });
});

describe('matchOf', () => {
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
        text_share: 0,
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
