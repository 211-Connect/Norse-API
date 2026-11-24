import { MATCH } from '../rules/match';
import { KeywordHit, keywordHit, keywordOwner, matchHit } from './name-owner';

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
