import {
  NameCandidate,
  NameHit,
  NameHits,
  alternateNames,
  capsTokens,
  claimName,
  genericName,
  nameHead,
  nameMatch,
  topicPhrase,
  nameHit,
  nameTypoClauses,
  nameWords,
} from './name-match';

let n = 0;
const svc = (
  org: string,
  service = 'Service',
  over: Partial<NameHit> = {},
): NameHit => ({
  id: `s${++n}`,
  org_id: org,
  org_name: org,
  alternate_names: [],
  service_name: service,
  taxonomy_names: [],
  text: service.toLowerCase(),
  ...over,
});
const claim = (
  q: string,
  hits: NameHit[],
  over: {
    unknownWords?: string[] | null;
    fusedIds?: string[];
    state?: NameHits['state'];
  } = {},
) =>
  claimName({
    words: q.split(' '),
    list: { state: over.state ?? 'ok', hits },
    unknownWords: over.unknownWords === undefined ? [] : over.unknownWords,
    fusedIds: over.fusedIds,
  });
const named = (...a: Parameters<typeof claim>) => claim(...a).org_ids;

beforeEach(() => {
  n = 0;
});

describe('claimName: a name that starts with the words', () => {
  it('one org is a claim, also the only org of the tenant', () => {
    expect(named('compass housing', [svc('Compass Housing Alliance')])).toEqual(
      ['Compass Housing Alliance'],
    );
  });
  it('the word order does not matter', () => {
    expect(named('housing compass', [svc('Compass Housing Alliance')])).toEqual(
      ['Compass Housing Alliance'],
    );
  });
  it.each([
    ['looking caridades catolicas'],
    ['busco caridades catolicas'],
    ['necesito ayuda caridades catolicas'],
    ['buscando caridades catolicas'],
  ])('the request words are not part of the name: %p', (q) => {
    expect(named(q, [svc('Caridades Catolicas')])).toEqual([
      'Caridades Catolicas',
    ]);
  });
  it.each([['necesito ayuda'], ['busco asistencia'], ['need help']])(
    'request words alone name nothing: %p',
    (q) => {
      expect(named(q, [svc('Ayuda Help Center')])).toEqual([]);
      expect(nameWords(q.split(' '))).toEqual([]);
    },
  );
  it('the same name in two orgs names both', () => {
    const hits = [
      svc('YMCA', 'Swim', { org_id: '1' }),
      svc('YMCA', 'Camp', { org_id: '2' }),
    ];
    expect(named('ymca', hits)).toEqual(['1', '2']);
  });
  it("an acronym inside a name ('DSHS ...') is a claim", () => {
    expect(
      named('dshs', [svc('DSHS Community Services Offices')]),
    ).toHaveLength(1);
  });
  it('an alternate name is a claim', () => {
    const hits = [svc('Tri Town Y', 'Swim', { alternate_names: ['YMCA'] })];
    expect(named('ymca', hits)).toHaveLength(1);
  });
  it('a service name is not an org name', () => {
    expect(
      named('medicare savings', [svc('Other', 'Medicare Savings')]),
    ).toEqual([]);
  });
  it('another org that offers a service by the name does not stop it', () => {
    const hits = [
      svc('Eatonville Family Agency', 'DSHS Advocate offered at Eatonville'),
      svc('DSHS Community Services Offices', 'Medicare Savings'),
    ];
    expect(named('dshs', hits)).toEqual(['DSHS Community Services Offices']);
  });
  it.each([
    [9, 1],
    [10, 0],
  ])(
    'the 10 first orgs are read: after %i other orgs the claim has %i',
    (before, count) => {
      const others = Array.from({ length: before }, (_, i) =>
        svc(`Other ${i}`),
      );
      // Hits of one org count once.
      const hits = [...others, svc('Other 0'), svc('DSHS Offices')];
      expect(named('dshs', hits)).toHaveLength(count);
    },
  );
});

describe('claimName: a name that only holds the words', () => {
  it("David's case: 'food bank' and one 'Ballard Food Bank' names nothing", () => {
    expect(named('food bank', [svc('Ballard Food Bank', 'Food Bank')])).toEqual(
      [],
    );
  });
  it('two orgs of one brand are a claim', () => {
    const hits = [
      svc('American Red Cross, Northwest Region', 'Blood'),
      svc('American Red Cross of Illinois', 'Shelter'),
    ];
    expect(named('red cross', hits)).toHaveLength(2);
  });
  it('one org stored twice is one name', () => {
    const hits = [
      svc('Ballard Food Bank', 'Meals', { org_id: '1' }),
      svc('BALLARD FOOD BANK', 'Meals', { org_id: '2' }),
    ];
    expect(named('food bank', hits)).toEqual([]);
  });
  it('two near-duplicates, and another org that offers a food bank: no claim', () => {
    const pair = [
      svc('Ballard Food Bank', 'Meals'),
      svc('Ballard Food Bank - Annex', 'Meals'),
    ];
    const other = svc('Jewish Family Service', 'Food Bank offered by JFS');
    expect(named('food bank', [...pair, other])).toEqual([]);
    // KNOWN LIMIT: without it, names alone look like a brand ('red cross').
    expect(named('food bank', pair)).toHaveLength(2);
  });
  it("the org's own name after the service name is not a service", () => {
    const hits = [
      svc('American Red Cross, NW', 'Blood'),
      svc('American Red Cross of IL', 'Shelter'),
      svc('City Hall', 'Shelter offered at Red Cross'),
      svc('City Hall', 'Blood | Red Cross'),
    ];
    expect(named('red cross', hits)).toHaveLength(2);
  });
  it('two places with the topic: no claim', () => {
    const hits = [svc('Auburn Food Bank'), svc('Sequim Food Bank')];
    expect(named('food bank', hits)).toEqual([]);
  });
});

describe('claimName: vetoes', () => {
  const start = () => svc('Food Bank of X', 'Meals');
  it("a topic of the directory is not a name ('Food Bank of X')", () => {
    const term = svc('Other', 'Pantry', {
      taxonomy_names: ['Food Banks/Food Distribution Warehouses'],
    });
    expect(claim('food bank', [start(), term])).toEqual({
      status: 'ok',
      org_ids: [],
      veto: 'topic',
      pins: [],
    });
    expect(named('food bank', [start()])).toEqual(['Food Bank of X']);
  });
  it('a typo of a topic is a topic', () => {
    const term = svc('Other', 'Pantry', { taxonomy_names: ['Food Banks'] });
    const r = claim('foood bank', [start(), term], { unknownWords: ['foood'] });
    expect(r.veto).toBe('topic');
  });
  it('a common word of the top hits is not a name; the fused order is the top', () => {
    const common = Array.from({ length: 20 }, (_, i) =>
      svc(`Other ${i}`, 'x', { text: 'veterans help' }),
    );
    const org = svc('Veterans', 'Help', { text: 'veterans' });
    const hits = [org, ...common];
    const ids = hits.map((h) => h.id);
    expect(claim('veterans', hits, { fusedIds: ids }).veto).toBe('generic');
    expect(claim('veterans', hits).veto).toBe('generic');
    // Fused ids that are no keyword hits say nothing.
    expect(named('veterans', hits, { fusedIds: [org.id, 'v1'] })).toHaveLength(
      1,
    );
  });
});

describe('claimName: typos', () => {
  const army = () => [svc('Salvation Army Longview')];
  it('a word no document holds is put right', () => {
    const r = named('salvaton army', army(), { unknownWords: ['salvaton'] });
    expect(r).toHaveLength(1);
  });
  it('a word that some document holds is not changed', () => {
    expect(named('salvaton army', army())).toEqual([]);
  });
  it('a word that some org name holds is spelled right', () => {
    const hits = [
      svc('Caring Food'),
      svc('Daring Food'),
      svc('Yakima Karing Food'),
    ];
    expect(named('karing food', hits, { unknownWords: ['karing'] })).toEqual(
      [],
    );
  });
  it('word counts failed (null): a typo cannot be told, so "no name" is not certain', () => {
    expect(claim('salvaton army', army(), { unknownWords: null }).status).toBe(
      'failed',
    );
    expect(
      claim('salvation army', army(), { unknownWords: null }),
    ).toMatchObject({ status: 'ok', org_ids: ['Salvation Army Longview'] });
  });
  it('two edits are not put right', () => {
    const r = named('worksource', [svc('Workforce Partnership')], {
      unknownWords: ['worksource'],
    });
    expect(r).toEqual([]);
  });
  it('a word of 4 letters is not put right', () => {
    const r = named('crss', [svc('Cross Center')], { unknownWords: ['crss'] });
    expect(r).toEqual([]);
  });
  it('a typo follows the same name rules', () => {
    const r = named('foood bank', [svc('Ballard Food Bank')], {
      unknownWords: ['foood'],
    });
    expect(r).toEqual([]);
  });
  it('a claim on the words as typed is not changed by a typo', () => {
    const hits = [svc('Hopelink'), svc('Hopelin Works')];
    expect(named('hopelin', hits, { unknownWords: ['hopelin'] })).toEqual(
      named('hopelin', hits),
    );
  });
  it('the clause: one edit, every word, org name only; none without an unknown word', () => {
    expect(nameTypoClauses('worksource', [])).toEqual([]);
    const [c] = nameTypoClauses('salvaton army', ['salvaton']);
    expect(c.multi_match).toMatchObject({
      query: 'salvaton army',
      operator: 'and',
      fields: ['organization.name'],
      fuzziness: 1,
      prefix_length: 2,
      boost: 0.01,
    });
  });
});

describe('claimName: pins', () => {
  const many = () =>
    Array.from({ length: 5 }, (_, i) => svc('Compass Housing', `s${i}`));
  it('at most 3, in the fused order, then in the keyword order', () => {
    const hits = many();
    const r = claim('compass housing', hits, { fusedIds: ['x', 's4', 's2'] });
    expect(r.pins).toEqual(['s4', 's2', 's1']);
  });
  it('no fused order: the keyword order', () => {
    expect(claim('compass housing', many()).pins).toEqual(['s1', 's2', 's3']);
  });
});

describe('claimName: no list', () => {
  const none = { org_ids: [], veto: null, pins: [] };
  it('failed (also with part of the hits) is a failed status, skipped is not', () => {
    const hits = [svc('Compass Housing')];
    expect(claim('compass', hits, { state: 'failed' })).toEqual({
      status: 'failed',
      ...none,
    });
    expect(claim('compass', [], { state: 'skipped' })).toEqual({
      status: 'ok',
      ...none,
    });
  });
  it.each(['', 'a', 'i need help', '98101', 'comida', 'ayuda con comida'])(
    "'%s' with no such org: no claim",
    (q) => {
      expect(claim(q, [svc('Compass Housing')])).toEqual({
        status: 'ok',
        ...none,
      });
      expect(claim(q, [])).toEqual({ status: 'ok', ...none });
    },
  );
  it('other scripts have no word to read: no claim', () => {
    expect(named('продукты', [svc('Compass Housing')])).toEqual([]);
    expect(named('食物', [svc('Compass Housing')])).toEqual([]);
  });
  it('accents and apostrophes are read as the query words are', () => {
    expect(named('womens shelter', [svc("Women's Shelter")])).toHaveLength(1);
    expect(
      named('childrens home', [svc('Children’s Home Society')]),
    ).toHaveLength(1);
    expect(nameHead('Women’s Center')).toEqual(nameHead("Women's Center"));
    expect(named('ninos unidos', [svc('Niños Unidos')])).toHaveLength(1);
  });
  // Known weak spot, the same in both languages: a name that is mostly a
  // request word is not claimed, because the word says nothing in a query.
  it.each([
    ['legal help', 'Legal Help'],
    ['ayuda legal', 'Ayuda Legal'],
  ])('a name that holds a request word is not claimed: %p', (q, org) => {
    expect(named(q, [svc(org)])).toEqual([]);
  });
  it('spaces in a service name are one space', () => {
    expect(nameHit('1', { name: 'Food   Bank\n at X' }).service_name).toBe(
      'Food Bank at X',
    );
  });
  it('a Spanish query names an org by its name', () => {
    expect(named('caridades catolicas', [svc('Caridades Catolicas')])).toEqual([
      'Caridades Catolicas',
    ]);
  });
});

describe('reading a hit', () => {
  it('a source with missing or odd fields never throws', () => {
    for (const src of [
      undefined,
      null,
      {},
      { organization: null, taxonomies: null },
      { organization: 'Org', taxonomies: [null, {}, 'x'] },
      { organization: { id: 5, name: 7, alternate_name: 9 } },
    ]) {
      expect(() => nameHit('1', src)).not.toThrow();
      expect(nameHit('1', src).org_id).toBeNull();
      expect(claim('org', [nameHit('1', src)]).org_ids).toEqual([]);
    }
  });
  it('reads the fields', () => {
    const src = {
      name: 'Swim',
      description: 'Pool',
      taxonomies: [{ name: 'Sports' }],
      organization: { id: 'o', name: 'YMCA', alternate_name: 'Y; Y Camp' },
    };
    expect(nameHit('1', src)).toEqual({
      id: '1',
      org_id: 'o',
      org_name: 'YMCA',
      alternate_names: ['Y', 'Y Camp'],
      service_name: 'Swim',
      taxonomy_names: ['Sports'],
      text: 'Swim Pool Sports',
    });
  });
  it('alternate names: a list, a string with ";", nothing', () => {
    expect(alternateNames('A; B;')).toEqual(['A', 'B']);
    expect(alternateNames(['A', 1, ' '])).toEqual(['A']);
    expect(alternateNames(undefined)).toEqual([]);
  });
  it('nameWords: empty when there is no word to match', () => {
    expect(nameWords(['food', 'bank'])).toEqual(['food', 'bank']);
    expect(nameWords(['i', 'need', '98101'])).toEqual([]);
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
    expect(r).toEqual({ start: false, org_ids: ['1', '4', '5'] });
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

describe('generic word veto', () => {
  const page = (org: string, text: string) => svc(org, 'x', { text });
  it("'veterans': 20 hold it, 7 org names do: generic", () => {
    const hits = [
      ...Array.from({ length: 7 }, (_, i) =>
        page(`Veterans Org ${i}`, 'veterans help'),
      ),
      ...Array.from({ length: 13 }, (_, i) =>
        page(`Other ${i}`, 'veterans aid'),
      ),
    ];
    expect(genericName(['veterans'], hits)).toBe(true);
  });
  it("'salvation army' 16 of 16: not generic", () => {
    const hits = Array.from({ length: 16 }, () =>
      page('Salvation Army', 'salvation army'),
    );
    expect(genericName(['salvation', 'army'], hits)).toBe(false);
  });
  it('fewer than 5 holders: not generic', () => {
    expect(genericName(['x1y'], [page('Other', 'x1y')])).toBe(false);
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
