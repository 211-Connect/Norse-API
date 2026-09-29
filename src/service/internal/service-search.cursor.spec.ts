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
  exclude: {
    serviceIds: ['s1', 's2'],
    rules: [
      {
        taxonomyCodes: ['LR', 'BD'],
        regionIds: [],
        statuses: [],
        virtual: null,
      },
      {
        taxonomyCodes: [],
        regionIds: ['state:KS'],
        statuses: ['active'],
        virtual: 'exclude',
      },
    ],
  },
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
  exclude: { serviceIds: ['s1'], rules: [] },
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

  it('changes when excluded serviceIds change, ignoring their order and repeats', () => {
    const ids = FULL.exclude.serviceIds;
    const reordered = {
      ...FULL,
      exclude: {
        ...FULL.exclude,
        serviceIds: [...ids].reverse().concat(ids[0]),
      },
    };
    const dropped = { ...FULL, exclude: { ...FULL.exclude, serviceIds: [] } };
    expect(queryFingerprint(reordered)).toBe(queryFingerprint(FULL));
    expect(queryFingerprint(dropped)).not.toBe(queryFingerprint(FULL));
  });

  it('ignores the order and repeats of rules and of the lists inside one', () => {
    const [first, second] = FULL.exclude.rules;
    const reordered = {
      ...FULL,
      exclude: {
        ...FULL.exclude,
        rules: [second, { ...first, taxonomyCodes: ['BD', 'LR', 'BD'] }, first],
      },
    };
    expect(queryFingerprint(reordered)).toBe(queryFingerprint(FULL));
    expect(shardPreference(reordered)).toBe(shardPreference(FULL));
  });

  it.each([
    ['a criterion list', { taxonomyCodes: ['LR'] }],
    ['a status', { statuses: ['active', 'inactive'] }],
    ['a Region', { regionIds: ['state:MO'] }],
    ['the virtual mode', { virtual: 'only' as const }],
    ['its owner', { ownerWriterId: 'writer-b' }],
  ])('changes when a rule changes %s', (_label, change) => {
    const [first, second] = FULL.exclude.rules;
    const changed = {
      ...FULL,
      exclude: {
        ...FULL.exclude,
        rules: [first, { ...second, ...change }],
      },
    };
    expect(queryFingerprint(changed)).not.toBe(queryFingerprint(FULL));
  });

  it('tells a rule scoped to an owner from the same rule unscoped (ISS-1939)', () => {
    const [first, second] = FULL.exclude.rules;
    const scoped = (ownerWriterId: string) => ({
      ...FULL,
      exclude: {
        ...FULL.exclude,
        rules: [first, { ...second, ownerWriterId }],
      },
    });
    expect(queryFingerprint(scoped('writer-a'))).not.toBe(
      queryFingerprint(FULL),
    );
    expect(queryFingerprint(scoped('writer-a'))).not.toBe(
      queryFingerprint(scoped('writer-b')),
    );
    const reordered = {
      ...FULL,
      exclude: {
        ...FULL.exclude,
        rules: [{ ...second, ownerWriterId: 'writer-a' }, first],
      },
    };
    expect(queryFingerprint(reordered)).toBe(
      queryFingerprint(scoped('writer-a')),
    );
  });

  it('does not let two rules read as one, or one as two', () => {
    const split = {
      ...FULL,
      exclude: {
        serviceIds: [],
        rules: [
          { taxonomyCodes: ['LR'], regionIds: [], statuses: [], virtual: null },
          {
            taxonomyCodes: [],
            regionIds: [],
            statuses: ['active'],
            virtual: null,
          },
        ],
      },
    };
    const joined = {
      ...FULL,
      exclude: {
        serviceIds: [],
        rules: [
          {
            taxonomyCodes: ['LR'],
            regionIds: [],
            statuses: ['active'],
            virtual: null,
          },
        ],
      },
    };
    expect(queryFingerprint(split)).not.toBe(queryFingerprint(joined));
  });

  describe('Withholdings (ISS-1938)', () => {
    const set = (version: number, serviceIds: string[] = ['s1']) => ({
      agreementId: 'agreement-1',
      ownerWriterId: 'writer-a',
      version,
      serviceIds,
    });
    const withheld = (...sets: ReturnType<typeof set>[]): CursorQuery => ({
      ...FULL,
      exclude: { ...FULL.exclude, withheld: sets },
    });

    it('changes with the version, and the Withholding named', () => {
      expect(queryFingerprint(withheld(set(2)))).not.toBe(
        queryFingerprint(withheld(set(3))),
      );
      expect(queryFingerprint(withheld(set(2)))).not.toBe(
        queryFingerprint(FULL),
      );
      expect(
        queryFingerprint(withheld({ ...set(2), ownerWriterId: 'writer-b' })),
      ).not.toBe(queryFingerprint(withheld(set(2))));
    });

    it('is named by its version, not its ids', () => {
      expect(queryFingerprint(withheld(set(2, ['s1'])))).toBe(
        queryFingerprint(withheld(set(2, ['s1', 's2']))),
      );
    });

    it('does not change with an empty Withholdings list', () => {
      expect(queryFingerprint(withheld())).toBe(queryFingerprint(FULL));
    });
  });

  describe('a query without exclusions hashes as before exclusions existed', () => {
    // Literals computed by origin/development's service-search.cursor.ts: a
    // cursor in flight at deploy, and its shard preference, must survive.
    const representative: CursorQuery = {
      resourceWriterIds: ['w1', 'w2'],
      taxonomyCodes: ['BD-1800'],
      statuses: ['active'],
      regionIds: ['state:MO'],
      points: [{ lat: 35.994, lng: -78.8986, radiusMiles: 10 }],
      virtual: 'only',
      match: 'located',
      text: 'food',
    };

    it.each([
      ['a bare query', { resourceWriterIds: ['w1'] }, '876ace889e247f4a'],
      ['a representative filter', representative, '10f190d94e5611da'],
    ])('%s', (_label, query: CursorQuery, fingerprint) => {
      expect(queryFingerprint(query)).toBe(fingerprint);
      expect(shardPreference(query)).toBe(`services-${fingerprint}`);
      expect(
        queryFingerprint({
          ...query,
          exclude: { serviceIds: [], rules: [], withheld: [] },
        }),
      ).toBe(fingerprint);
    });

    it('accepts a cursor development issued', () => {
      const issued = Buffer.from(
        JSON.stringify({
          v: 1,
          m: 'score',
          k: '876ace889e247f4a',
          s: [1.5, 's1'],
        }),
      ).toString('base64url');
      expect(
        decodeCursor(issued, 'score', { resourceWriterIds: ['w1'] }),
      ).toEqual([1.5, 's1']);
    });
  });

  it('treats absent exclusions as empty ones', () => {
    const bare: CursorQuery = { resourceWriterIds: ['writer-a'] };
    expect(
      queryFingerprint({ ...bare, exclude: { serviceIds: [], rules: [] } }),
    ).toBe(queryFingerprint(bare));
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
