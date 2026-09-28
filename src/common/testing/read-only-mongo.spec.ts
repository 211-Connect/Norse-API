import {
  CollectionLike,
  ReadOnlyCollection,
  ReadOnlyMongoViolationError,
} from './read-only-mongo';

describe('ReadOnlyCollection', () => {
  const aggregate = jest.fn(() => ({ toArray: async () => [] }));
  const find = jest.fn(() => ({ toArray: async () => [] }));
  const countDocuments = jest.fn(async () => 0);
  const collection = new ReadOnlyCollection({
    aggregate,
    find,
    countDocuments,
  } as unknown as CollectionLike);

  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['$out', [{ $match: {} }, { $out: 'x' }]],
    ['$merge', [{ $merge: { into: 'x' } }]],
    ['$unwind (not on the allowlist)', [{ $unwind: '$a' }]],
    ['two operators in one stage', [{ $match: {}, $out: 'x' }]],
    ['$where in a $match', [{ $match: { $where: 'true' } }]],
    [
      '$function in a $group',
      [{ $group: { _id: { $function: { body: 'x', args: [], lang: 'js' } } } }],
    ],
  ])('refuses %s without calling the driver', async (_name, pipeline) => {
    await expect(async () =>
      collection.aggregate(pipeline),
    ).rejects.toBeInstanceOf(ReadOnlyMongoViolationError);
    expect(aggregate).not.toHaveBeenCalled();
  });

  it('passes an allowed pipeline through', async () => {
    const pipeline = [
      { $match: { a: 1 } },
      { $group: { _id: '$s', n: { $sum: 1 } } },
      { $project: { n: 1 } },
      { $count: 'c' },
    ];
    await collection.aggregate(pipeline);
    expect(aggregate).toHaveBeenCalledWith(pipeline, expect.any(Object));
  });

  it('requires a projection on find and refuses $where in a filter', async () => {
    expect(() => collection.find({}, {})).toThrow(ReadOnlyMongoViolationError);
    expect(() => collection.find({ $where: 'true' }, { a: 1 })).toThrow(
      ReadOnlyMongoViolationError,
    );
    expect(find).not.toHaveBeenCalled();
    await collection.find({ a: 1 }, { a: 1 });
    expect(find).toHaveBeenCalledTimes(1);
  });

  it('has no write methods', () => {
    for (const name of [
      'insertOne',
      'updateMany',
      'deleteMany',
      'bulkWrite',
      'drop',
    ]) {
      expect(
        (collection as unknown as Record<string, unknown>)[name],
      ).toBeUndefined();
    }
  });
});
