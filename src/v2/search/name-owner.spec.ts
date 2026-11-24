import { keywordHit, matchHit } from './name-owner';

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
