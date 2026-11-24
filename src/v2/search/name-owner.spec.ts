import { MATCH } from '../rules/match';
import {
  KeywordHit,
  NAME_VARIANTS,
  NameOwner,
  keywordHit,
  keywordOwner,
  matchHit,
  nameScore,
  parseNameVariants,
  withTopicVeto,
} from './name-owner';

describe('matchHit', () => {
  it('reads org name (string or object) and the lowercased text', () => {
    expect(
      matchHit({
        name: 'Swim Class',
        description: 'Learn',
        summary: 'S',
        taxonomies: [{ name: 'Recreation' }, {}],
        organization: { name: 'YMCA' },
      }),
    ).toEqual({ org_name: 'YMCA', text: 'swim class learn s recreation' });
    expect(matchHit({ organization: 'Plain' }).org_name).toBe('Plain');
    expect(matchHit(undefined)).toEqual({ org_name: null, text: '' });
  });
});

describe('keywordHit', () => {
  it('adds id, org id, alternate names and the service name', () => {
    expect(
      keywordHit('s1', {
        name: 'Food Pantry',
        organization: {
          id: 'o1',
          name: 'Compass',
          alternate_name: ['Compass Housing', 7],
        },
      }),
    ).toEqual({
      org_name: 'Compass',
      text: 'food pantry',
      id: 's1',
      org_id: 'o1',
      alternate_names: ['Compass Housing'],
      service_name: 'Food Pantry',
      taxonomy_names: [],
    });
  });
  it('splits a string of alternate names; missing fields give null and empty', () => {
    expect(
      keywordHit('s2', { organization: { alternate_name: 'Alt; Second' } }),
    ).toMatchObject({
      org_id: null,
      alternate_names: ['Alt', 'Second'],
      service_name: '',
    });
    expect(keywordHit('s3', undefined)).toMatchObject({
      org_id: null,
      alternate_names: [],
    });
  });
});

describe('keywordOwner', () => {
  const h = (
    id: string,
    org_id: string | null,
    org: string,
    service: string,
    alt: string[] = [],
  ): KeywordHit => ({
    id,
    org_id,
    org_name: org,
    alternate_names: alt,
    service_name: service,
    taxonomy_names: [],
    text: service.toLowerCase(),
  });
  const ok = (hits: KeywordHit[]) => ({ state: 'ok' as const, hits });
  const words = ['compass', 'housing'];
  const owner = keywordOwner(words);

  it('claims the pin from the keyword hits', () => {
    expect(owner.pinFrom).toBe('keyword');
  });
  it('a failed keyword list is failed; a skipped one is skipped, none', async () => {
    expect((await owner.claim({ state: 'failed', hits: [] })).status).toBe(
      'failed',
    );
    expect(await owner.claim({ state: 'skipped', hits: [] })).toEqual({
      status: 'skipped',
      strength: 'none',
      org_ids: [],
      service_ids: [],
      name: null,
    });
  });
  it('org strength: the org name fits; service ids are its hits whose service name holds a query word', async () => {
    const c = await owner.claim(
      ok([
        h('s1', 'o1', 'Other Org', 'Food'),
        h('s2', 'o2', 'Compass Housing Alliance', 'Housing help'),
        h('s3', 'o2', 'Compass Housing Alliance', 'Legal aid'),
        h('s4', 'o2', 'Compass Housing Alliance', 'Compass Intake'),
      ]),
    );
    expect(c).toMatchObject({
      status: 'ok',
      strength: 'org',
      org_ids: ['o2'],
      service_ids: ['s2', 's4'],
      name: 'Compass Housing Alliance',
    });
  });
  it('an alternate name counts', async () => {
    const c = await keywordOwner(['ymca']).claim(
      ok([h('s1', 'o1', 'Young Mens Christian Association', 'Swim', ['YMCA'])]),
    );
    expect(c).toMatchObject({ strength: 'org', org_ids: ['o1'] });
  });
  it('only the first nameLookupSize unique orgs are candidates', async () => {
    const hits = Array.from({ length: MATCH.nameLookupSize }, (_, i) =>
      h(`s${i}`, `o${i}`, `Other ${i}`, 'Food'),
    );
    hits.push(h('late', 'oX', 'Compass Housing Alliance', 'Housing'));
    expect((await owner.claim(ok(hits))).strength).toBe('none');
  });
  it('service strength: every query word in the service name, suffix removed', async () => {
    const c = await owner.claim(
      ok([
        h('s1', 'o1', 'Other', 'Compass Housing offered by Other Org'),
        h('s2', 'o2', 'Another', 'Food | Compass Housing'),
        h('s3', 'o3', 'Third', 'Compass Intake'),
        h('s4', 'o4', 'Fourth', 'Housing at Compass'),
      ]),
    );
    expect(c).toMatchObject({
      status: 'ok',
      strength: 'service',
      org_ids: [],
      service_ids: ['s1'],
    });
  });
  it('none when neither fits', async () => {
    const c = await owner.claim(ok([h('s1', 'o1', 'Other', 'Food')]));
    expect(c).toMatchObject({ strength: 'none', service_ids: [] });
  });
  it('vetoes a common word held by many hits that do not carry it in the org name', () => {
    const generic = keywordOwner(['veterans']);
    const evidence = Array.from({ length: 8 }, (_, i) => ({
      ...h(`s${i}`, `o${i}`, `Org ${i}`, 'Veterans help'),
      text: 'veterans help',
    }));
    expect(generic.vetoes(evidence)).toBe(true);
    expect(generic.vetoes([])).toBe(false);
  });
});

describe('keywordOwner variants (V2_NAME_MATCH_VARIANTS, off by default)', () => {
  const hit = (id: string, org: string, over: Partial<KeywordHit> = {}) => ({
    ...keywordHit(id, {
      name: 'svc',
      organization: { id: `o-${id}`, name: org },
    }),
    ...over,
  });
  const claim = (words: string[], hits: KeywordHit[], v: string) =>
    keywordOwner(words, words.join(' '), parseNameVariants(v)).claim({
      state: 'ok',
      hits,
    });
  const clauses = (v: string, typoClauses = true) =>
    JSON.stringify(
      keywordOwner(['compass'], 'compass', parseNameVariants(v)).clauses?.({
        words: { compass: 6 },
        typoClauses,
      }) ?? [],
    );

  it('parses known values only; none gives no clauses function', () => {
    expect(parseNameVariants(undefined)).toEqual([]);
    expect(parseNameVariants(' typo, nope,boost')).toEqual(['boost', 'typo']);
    expect(keywordOwner(['a'], 'a').clauses).toBeUndefined();
  });

  it('each variant adds its own clauses, all of them named', () => {
    for (const v of NAME_VARIANTS.filter((x) => x !== 'metric')) {
      expect(clauses(v)).toContain(`name_owner:${v}`);
      for (const other of NAME_VARIANTS.filter((x) => x !== v)) {
        expect(clauses(v)).not.toContain(`name_owner:${other}`);
      }
    }
    expect(clauses('metric')).toContain('name_owner:boost');
    expect(clauses('metric')).toContain('name_owner:phrase');
    expect(clauses('rare')).toContain('"boost":36');
    expect(clauses('typo', false)).toBe('[]');
    expect(clauses('typo')).toContain('fuzziness');
  });

  it('nameScore sums the name clauses only; names without scores give null', () => {
    expect(nameScore(undefined)).toBe(0);
    expect(nameScore({ 'name_owner:boost:name': 2, other: 9 })).toBe(2);
    expect(nameScore(['name_owner:alias'])).toBeNull();
  });

  it('metric: the org with most of its score from its name; no name text is read', async () => {
    const r = await claim(
      ['zzz'],
      [
        hit('1', 'Compass', { name_score: 8, score: 10 }),
        hit('2', 'Other', { name_score: 1, score: 10 }),
      ],
      'metric',
    );
    expect(r).toMatchObject({ strength: 'org', org_ids: ['o-1'], metric: 0.8 });
  });

  it('metric: words common to many org names name nothing; no scores is a failure', async () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      hit(String(i), `Town ${i} Food Bank`, { name_score: 8, score: 10 }),
    );
    expect((await claim(['food', 'bank'], many, 'metric')).strength).toBe(
      'none',
    );
    expect(
      (await claim(['x'], [hit('1', 'X', { name_score: null })], 'metric'))
        .status,
    ).toBe('failed');
  });

  it('typo: a one-edit typo of an org name claims it, and the veto reads the corrected words', async () => {
    const hits = Array.from({ length: 5 }, (_, i) =>
      hit(String(i), 'Hopelink', { org_id: 'h', text: 'hopelink help' }),
    );
    expect((await claim(['hopelnik'], hits, '')).strength).toBe('none');
    const owner = keywordOwner(['hopelnik'], 'hopelnik', ['typo']);
    const r = await owner.claim({ state: 'ok', hits });
    expect(r).toMatchObject({ strength: 'org', org_ids: ['h'] });
    expect(owner.vetoes(hits)).toBe(false);
  });
});

describe('David #367 point 1: food bank, keyword owner', () => {
  const orgs = (names: string[]) =>
    names.map((n, i) =>
      keywordHit(`s${i}`, {
        name: 'Food Bank',
        organization: { id: `o${i}`, name: n },
      }),
    );
  it('two three-word food banks with different first words: no org is named', async () => {
    const r = await keywordOwner(['food', 'bank']).claim({
      state: 'ok',
      hits: orgs(['Ballard Food Bank', 'Edmonds Food Bank', 'North Helpline']),
    });
    expect(r.strength).not.toBe('org');
  });
  it('one food-bank org among services that only mention it: claimed, then vetoed', async () => {
    const hits = orgs([
      'Ballard Food Bank',
      'Hopelink',
      'YMCA',
      'Solid Ground',
      'El Centro',
    ]);
    const owner = keywordOwner(['food', 'bank']);
    expect((await owner.claim({ state: 'ok', hits })).strength).toBe('org');
    expect(owner.vetoes(hits)).toBe(true);
  });
  it('NOT fixed: one food-bank org fills the page (claimed, not vetoed)', async () => {
    const hits = orgs(Array(5).fill('Ballard Food Bank'));
    const owner = keywordOwner(['food', 'bank']);
    expect((await owner.claim({ state: 'ok', hits })).strength).toBe('org');
    expect(owner.vetoes(hits)).toBe(false);
  });
});

describe('topic veto (V2_NAME_TOPIC_VETO): food bank, one candidate', () => {
  const hit = (i: number, terms: string[]) =>
    keywordHit(`s${i}`, {
      name: 'Food Bank',
      taxonomies: terms.map((name) => ({ name })),
      organization: { id: 'o1', name: 'Ballard Food Bank' },
    });
  const page = (terms: string[]) => [0, 1, 2, 3, 4].map((i) => hit(i, terms));
  const owner = (): NameOwner => keywordOwner(['food', 'bank']);
  it('claimed and not vetoed by the generic check; the topic check stops it', async () => {
    const hits = page(['Food Banks/Food Distribution Warehouses']);
    const o = withTopicVeto(owner(), ['food', 'bank']);
    expect((await o.claim({ state: 'ok', hits })).strength).toBe('org');
    expect(o.vetoes(hits)).toBe(false);
    expect(o.topic?.(hits)).toBe(true);
  });
  it('NOT fixed: the hits hold only another term (Food Pantries): still claimed', async () => {
    const hits = page(['Food Pantries']);
    const o = withTopicVeto(owner(), ['food', 'bank']);
    expect((await o.claim({ state: 'ok', hits })).strength).toBe('org');
    expect(o.topic?.(hits)).toBe(false);
  });
  it('off: the owner has no topic check; no taxonomy on the hits: no veto', () => {
    expect(owner().topic).toBeUndefined();
    expect(withTopicVeto(owner(), ['food', 'bank']).topic?.(page([]))).toBe(
      false,
    );
  });
});
