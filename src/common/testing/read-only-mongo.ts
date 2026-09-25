/**
 * Read-only access to one MongoDB collection, for suites that compare against
 * production. The credential may be able to write; this wrapper cannot. It
 * exposes countDocuments, a projected find and an aggregate whose stages are
 * limited to $match, $group, $project and $count, and it refuses server-side
 * JavaScript anywhere in a filter or pipeline.
 */

export const READ_ONLY_STAGES = new Set([
  '$match',
  '$group',
  '$project',
  '$count',
]);
const SERVER_JS_OPERATORS = new Set(['$where', '$function', '$accumulator']);

export class ReadOnlyMongoViolationError extends Error {
  constructor(reason: string) {
    super(`Read-only Mongo wrapper refused: ${reason}`);
    this.name = 'ReadOnlyMongoViolationError';
  }
}

function assertNoServerJs(value: unknown): void {
  if (Array.isArray(value)) return value.forEach(assertNoServerJs);
  if (value === null || typeof value !== 'object') return;
  for (const [key, inner] of Object.entries(value)) {
    if (SERVER_JS_OPERATORS.has(key))
      throw new ReadOnlyMongoViolationError(key);
    assertNoServerJs(inner);
  }
}

export function assertReadOnlyPipeline(pipeline: readonly object[]): void {
  for (const stage of pipeline) {
    const keys = Object.keys(stage);
    if (keys.length !== 1 || !READ_ONLY_STAGES.has(keys[0])) {
      throw new ReadOnlyMongoViolationError(`stage ${keys.join(',') || '{}'}`);
    }
  }
  assertNoServerJs(pipeline);
}

/** The subset of a driver Collection this wrapper calls. */
export interface CollectionLike {
  countDocuments(filter: object, options?: object): Promise<number>;
  find(filter: object, options?: object): { toArray(): Promise<object[]> };
  aggregate(
    pipeline: object[],
    options?: object,
  ): { toArray(): Promise<object[]> };
}

export class ReadOnlyCollection {
  constructor(
    private readonly collection: CollectionLike,
    private readonly maxTimeMS = 60_000,
  ) {}

  countDocuments(filter: object): Promise<number> {
    assertNoServerJs(filter);
    return this.collection.countDocuments(filter, {
      maxTimeMS: this.maxTimeMS,
    });
  }

  /** A projection is required: a production document averages ~18 KB. */
  find<T = object>(
    filter: object,
    projection: Record<string, 0 | 1>,
  ): Promise<T[]> {
    assertNoServerJs(filter);
    if (Object.keys(projection).length === 0) {
      throw new ReadOnlyMongoViolationError('find without a projection');
    }
    return this.collection
      .find(filter, { projection, batchSize: 2000, maxTimeMS: this.maxTimeMS })
      .toArray() as Promise<T[]>;
  }

  aggregate<T = object>(pipeline: object[]): Promise<T[]> {
    assertReadOnlyPipeline(pipeline);
    return this.collection
      .aggregate(pipeline, { maxTimeMS: this.maxTimeMS })
      .toArray() as Promise<T[]>;
  }
}
