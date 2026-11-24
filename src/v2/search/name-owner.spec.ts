import { NameCandidate } from '../rules/match';
import { keywordHit, matchHit, resolverOwner } from './name-owner';

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
  it('accepts a string alternate name; missing fields give null and empty', () => {
    expect(
      keywordHit('s2', { organization: { alternate_name: 'Alt' } }),
    ).toMatchObject({
      org_id: null,
      alternate_names: ['Alt'],
      service_name: '',
    });
    expect(keywordHit('s3', undefined)).toMatchObject({
      org_id: null,
      alternate_names: [],
    });
  });
});

describe('resolverOwner', () => {
  const cand = (id: string, name: string): NameCandidate => ({
    id,
    name,
    alternate_names: [],
  });
  const kw = { state: 'ok' as const, hits: [] };
  const words = ['compass', 'housing'];

  it('reads from the index', () => {
    expect(resolverOwner(words, Promise.resolve([])).pinFrom).toBe('read');
  });
  it('a null lookup is failed', async () => {
    const o = resolverOwner(words, Promise.resolve(null));
    expect((await o.claim(kw)).status).toBe('failed');
  });
  it('a named org is org strength with its ids and name', async () => {
    const o = resolverOwner(
      words,
      Promise.resolve([cand('o2', 'Compass Housing Alliance')]),
    );
    expect(await o.claim(kw)).toEqual({
      status: 'ok',
      strength: 'org',
      org_ids: ['o2'],
      service_ids: [],
      name: 'Compass Housing Alliance',
    });
  });
  it('no org named: none', async () => {
    const o = resolverOwner(words, Promise.resolve([cand('o1', 'Other')]));
    expect(await o.claim(kw)).toMatchObject({ status: 'ok', strength: 'none' });
  });
  it('ignores the keyword hits and state', async () => {
    const o = resolverOwner(
      words,
      Promise.resolve([cand('o2', 'Compass Housing Alliance')]),
    );
    expect((await o.claim({ state: 'skipped', hits: [] })).strength).toBe(
      'org',
    );
  });
  it('a lookup that rejects is failed', async () => {
    const o = resolverOwner(words, Promise.reject(new Error('x')));
    expect((await o.claim(kw)).status).toBe('failed');
  });
  it('vetoes a generic word', () => {
    const o = resolverOwner(['veterans'], Promise.resolve([]));
    const evidence = Array.from({ length: 8 }, (_, i) => ({
      ...keywordHit(`s${i}`, {
        name: 'Veterans help',
        organization: { id: `o${i}`, name: `Org ${i}` },
      }),
    }));
    expect(o.vetoes(evidence)).toBe(true);
  });
});
