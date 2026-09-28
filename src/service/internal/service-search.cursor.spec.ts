import {
  CursorQuery,
  decodeCursor,
  encodeCursor,
  queryFingerprint,
  shardPreference,
} from './service-search.cursor';

/**
 * Required<> makes this fail to compile when a field is added to the query
 * types without a value here, and the test below then fails if that field is
 * left out of the fingerprint.
 */
const FULL: Required<CursorQuery> = {
  resourceWriterIds: ['writer-a', 'writer-b'],
  taxonomyCodes: ['BD-1800', 'LV-1000'],
  statuses: ['active', 'inactive'],
  regionIds: ['county:29510', 'state:MO'],
  points: [
    { lat: 35.994, lng: -78.8986, radiusMiles: 10 },
    { lat: 39.0997, lng: -94.5786, radiusMiles: 5 },
  ],
  virtual: 'only',
  match: 'located',
  text: 'food',
};

const OTHER: Required<CursorQuery> = {
  resourceWriterIds: ['writer-c'],
  taxonomyCodes: ['BD-18'],
  statuses: ['pending'],
  regionIds: ['zip:63110'],
  points: [{ lat: 35.994, lng: -78.8986, radiusMiles: 25 }],
  virtual: 'exclude',
  match: 'serves',
  text: 'shelter',
};

describe('queryFingerprint', () => {
  it.each(Object.keys(FULL) as (keyof CursorQuery)[])(
    'changes when %s changes',
    (key) => {
      const changed = { ...FULL, [key]: OTHER[key] };
      expect(queryFingerprint(changed)).not.toBe(queryFingerprint(FULL));
    },
  );

  it.each(['resourceWriterIds', 'taxonomyCodes', 'statuses', 'regionIds'])(
    'ignores the order and repeats of %s',
    (key) => {
      const values = FULL[key as keyof CursorQuery] as string[];
      const shuffled = {
        ...FULL,
        [key]: [...values].reverse().concat(values[0]),
      };
      expect(queryFingerprint(shuffled)).toBe(queryFingerprint(FULL));
      expect(shardPreference(shuffled)).toBe(shardPreference(FULL));
    },
  );

  it('ignores the order and repeats of points', () => {
    const shuffled = {
      ...FULL,
      points: [...FULL.points].reverse().concat(FULL.points[0]),
    };
    expect(queryFingerprint(shuffled)).toBe(queryFingerprint(FULL));
  });

  it('accepts a cursor replayed with the same sets in another order', () => {
    const cursor = encodeCursor('score', FULL, [1.5, 's1']);
    const reordered: CursorQuery = {
      ...FULL,
      resourceWriterIds: ['writer-b', 'writer-a'],
      regionIds: ['state:MO', 'county:29510'],
    };
    expect(decodeCursor(cursor, 'score', reordered)).toEqual([1.5, 's1']);
  });

  it('ignores match without a Place, where it changes nothing', () => {
    const bare: CursorQuery = { resourceWriterIds: ['writer-a'] };
    expect(queryFingerprint({ ...bare, match: 'located' })).toBe(
      queryFingerprint(bare),
    );
  });

  it('treats absent lists as empty and absent virtual as all', () => {
    const bare: CursorQuery = { resourceWriterIds: ['writer-a'] };
    expect(
      queryFingerprint({
        ...bare,
        taxonomyCodes: [],
        statuses: [],
        regionIds: [],
        points: [],
        virtual: 'all',
        match: 'serves',
        text: '  ',
      }),
    ).toBe(queryFingerprint(bare));
  });
});
