import {
  RekeyMappingError,
  RewriteCollections,
  parseMapping,
  rewriteSavedIds,
} from './rewrite-saved-ids';

/**
 * The cutover rewrite of saved ids (ISS-2516). The collections are in-memory
 * fakes that EVALUATE the filters the rewrite sends (equality, `$in` over a
 * scalar or an array, dotted paths through arrays), so a query or update
 * that leaves out the tenant reaches the other tenant's documents and goes
 * red here, as it would against Mongo.
 */

const T = 'aaaaaaaa-1111-4111-8111-111111111111';
const OTHER = 'bbbbbbbb-2222-4222-8222-222222222222';

type Doc = Record<string, any>;

const valuesAt = (doc: unknown, path: string[]): unknown[] => {
  if (path.length === 0) return [doc];
  if (Array.isArray(doc)) return doc.flatMap((d) => valuesAt(d, path));
  if (doc && typeof doc === 'object') {
    return valuesAt((doc as Doc)[path[0]], path.slice(1));
  }
  return [undefined];
};

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

const matches = (doc: Doc, filter: Doc): boolean =>
  Object.entries(filter).every(([key, expected]) => {
    const raw = valuesAt(doc, key.split('.'));
    const values = raw.flatMap((v) => (Array.isArray(v) ? [v, ...v] : [v]));
    if (expected && typeof expected === 'object' && '$in' in expected) {
      return values.some((v) =>
        (expected.$in as unknown[]).some((e) => same(e ?? null, v ?? null)),
      );
    }
    if (expected === null) return values.every((v) => v == null);
    return values.some((v) => same(v, expected));
  });

class FakeCollection {
  writes = 0;
  constructor(public docs: Doc[]) {}

  find(filter: Doc) {
    const found = this.docs
      .filter((d) => matches(d, filter))
      .map((d) => structuredClone(d));
    return { toArray: async () => found };
  }

  async countDocuments(filter: Doc) {
    return this.docs.filter((d) => matches(d, filter)).length;
  }

  async updateOne(filter: Doc, update: { $set: Doc }) {
    this.writes += 1;
    const doc = this.docs.find((d) => matches(d, filter));
    if (!doc) return { matchedCount: 0, modifiedCount: 0 };
    Object.assign(doc, structuredClone(update.$set));
    return { matchedCount: 1, modifiedCount: 1 };
  }
}

const OLD_A = 'old-a';
const NEW_A = 'new-a';
const OLD_B = 'old-b';
const NEW_B = 'new-b';
const KEPT = 'kept';

const mapping = new Map([
  [OLD_A, NEW_A],
  [OLD_B, NEW_B],
]);

function fixture() {
  const favoriteLists = new FakeCollection([
    { _id: 'fl-1', tenantId: T, updatedAt: 't1', favorites: [OLD_A, KEPT] },
    // Holds both an old id and its new id: one entry survives.
    { _id: 'fl-2', tenantId: T, updatedAt: 't1', favorites: [NEW_A, OLD_A] },
    { _id: 'fl-3', tenantId: T, updatedAt: 't1', favorites: [KEPT] },
    { _id: 'fl-other', tenantId: OTHER, updatedAt: 't1', favorites: [OLD_A] },
    { _id: 'fl-legacy', updatedAt: 't1', favorites: [OLD_B] },
  ]);
  const printableDirectories = new FakeCollection([
    {
      _id: 'pd-1',
      tenantId: T,
      updatedAt: 't1',
      sections: [
        {
          id: 's1',
          sources: [
            { id: 'src1', type: 'resource_ids', resourceIds: [KEPT, OLD_B] },
            { id: 'src2', type: 'query', query: { params: { q: 'food' } } },
          ],
        },
      ],
    },
    {
      _id: 'pd-other',
      tenantId: OTHER,
      updatedAt: 't1',
      sections: [
        {
          id: 's1',
          sources: [{ id: 'src1', type: 'resource_ids', resourceIds: [OLD_B] }],
        },
      ],
    },
  ]);
  const redirects = new FakeCollection([
    { _id: OLD_A, newId: NEW_A, tenantId: T },
  ]);
  const collections: RewriteCollections = {
    favoriteLists: favoriteLists as any,
    printableDirectories: printableDirectories as any,
    redirects: redirects as any,
  };
  return { favoriteLists, printableDirectories, redirects, collections };
}

describe('rewriteSavedIds', () => {
  it('dry run reports what it would change and writes nothing', async () => {
    const f = fixture();
    const before = structuredClone([
      f.favoriteLists.docs,
      f.printableDirectories.docs,
    ]);

    const report = await rewriteSavedIds(f.collections, {
      tenantId: T,
      mapping,
      dryRun: true,
    });

    expect(f.favoriteLists.writes + f.printableDirectories.writes).toBe(0);
    expect([f.favoriteLists.docs, f.printableDirectories.docs]).toEqual(before);
    expect(report).toMatchObject({
      tenantId: T,
      dryRun: true,
      favoriteLists: { matched: 2, changed: 2, idsReplaced: 2 },
      printableDirectories: { matched: 1, changed: 1, idsReplaced: 1 },
      tenantless: { favoriteLists: 1, printableDirectories: 0 },
      mapping: { entries: 2, withoutRedirectRow: 1 },
    });
  });

  it("replaces old ids with new ones in this tenant's lists and directory sources", async () => {
    const f = fixture();

    const report = await rewriteSavedIds(f.collections, {
      tenantId: T,
      mapping,
      dryRun: false,
    });

    const byId = (c: FakeCollection, id: string) =>
      c.docs.find((d) => d._id === id)!;
    expect(byId(f.favoriteLists, 'fl-1').favorites).toEqual([NEW_A, KEPT]);
    expect(byId(f.favoriteLists, 'fl-2').favorites).toEqual([NEW_A]);
    expect(byId(f.favoriteLists, 'fl-3').favorites).toEqual([KEPT]);
    expect(
      byId(f.printableDirectories, 'pd-1').sections[0].sources[0].resourceIds,
    ).toEqual([KEPT, NEW_B]);
    // Other source types are left exactly as they were.
    expect(byId(f.printableDirectories, 'pd-1').sections[0].sources[1]).toEqual(
      { id: 'src2', type: 'query', query: { params: { q: 'food' } } },
    );
    expect(report.favoriteLists).toMatchObject({ changed: 2, skipped: 0 });
    expect(report.printableDirectories).toMatchObject({ changed: 1 });
  });

  it("never touches another tenant's data, or a list with no tenant", async () => {
    const f = fixture();

    await rewriteSavedIds(f.collections, {
      tenantId: T,
      mapping,
      dryRun: false,
    });

    expect(
      f.favoriteLists.docs.find((d) => d._id === 'fl-other')!.favorites,
    ).toEqual([OLD_A]);
    expect(
      f.favoriteLists.docs.find((d) => d._id === 'fl-legacy')!.favorites,
    ).toEqual([OLD_B]);
    expect(
      f.printableDirectories.docs.find((d) => d._id === 'pd-other')!.sections[0]
        .sources[0].resourceIds,
    ).toEqual([OLD_B]);
  });

  it('is idempotent: a second run changes nothing', async () => {
    const f = fixture();
    const opts = { tenantId: T, mapping, dryRun: false };

    await rewriteSavedIds(f.collections, opts);
    const afterFirst = structuredClone([
      f.favoriteLists.docs,
      f.printableDirectories.docs,
    ]);
    const writesAfterFirst =
      f.favoriteLists.writes + f.printableDirectories.writes;
    const second = await rewriteSavedIds(f.collections, opts);

    expect([f.favoriteLists.docs, f.printableDirectories.docs]).toEqual(
      afterFirst,
    );
    expect(f.favoriteLists.writes + f.printableDirectories.writes).toBe(
      writesAfterFirst,
    );
    expect(second.favoriteLists.changed).toBe(0);
    expect(second.printableDirectories.changed).toBe(0);
  });

  it('skips, and counts, a document edited between read and write', async () => {
    const f = fixture();
    const realFind = f.favoriteLists.find.bind(f.favoriteLists);
    f.favoriteLists.find = (filter: Doc) => {
      const result = realFind(filter);
      // Someone saves fl-1 after the rewrite read it.
      f.favoriteLists.docs.find((d) => d._id === 'fl-1')!.updatedAt = 't2';
      return result;
    };

    const report = await rewriteSavedIds(f.collections, {
      tenantId: T,
      mapping,
      dryRun: false,
    });

    expect(
      f.favoriteLists.docs.find((d) => d._id === 'fl-1')!.favorites,
    ).toEqual([OLD_A, KEPT]);
    expect(report.favoriteLists).toMatchObject({ changed: 1, skipped: 1 });
  });
});

describe('parseMapping', () => {
  it('reads JSON pairs and CSV', () => {
    expect(parseMapping('[{"oldId":"a","newId":"b"}]', 'mapping.json')).toEqual(
      new Map([['a', 'b']]),
    );
    expect(parseMapping('old_id,new_id\na,b\nc,d\n', 'mapping.csv')).toEqual(
      new Map([
        ['a', 'b'],
        ['c', 'd'],
      ]),
    );
  });

  it.each([
    ['a chain (a new id is also an old id)', 'old_id,new_id\na,b\nb,c\n'],
    ['one old id mapped to two new ids', 'old_id,new_id\na,b\na,c\n'],
    ['an id mapped to itself', 'old_id,new_id\na,a\n'],
    ['an empty id', 'old_id,new_id\na,\n'],
    ['no rows', 'old_id,new_id\n'],
  ])('refuses %s', (_label, csv) => {
    expect(() => parseMapping(csv, 'mapping.csv')).toThrow(RekeyMappingError);
  });
});
