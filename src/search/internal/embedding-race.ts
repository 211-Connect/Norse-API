export type EmbeddingSide = 'local' | 'remote';

export interface EmbeddingRaceResult {
  embedding: number[];
  winner: EmbeddingSide;
}

export function isUsableEmbedding(v: unknown): v is number[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

const messageOf = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

export class EmbeddingRaceError extends Error {
  constructor(readonly errors: Record<EmbeddingSide, unknown>) {
    super(
      `local: ${messageOf(errors.local)}; remote: ${messageOf(errors.remote)}`,
    );
    this.name = 'EmbeddingRaceError';
  }
}

/**
 * Starts both calls at once and resolves with the first usable embedding.
 * The slower side is not aborted: it runs to its own timeout so its latency
 * metric is still recorded, and its late result or error is ignored.
 */
export function raceEmbeddings(
  calls: Record<EmbeddingSide, () => Promise<number[]>>,
): Promise<EmbeddingRaceResult> {
  return new Promise((resolve, reject) => {
    const errors: Record<EmbeddingSide, unknown> = {
      local: undefined,
      remote: undefined,
    };
    let failed = 0;
    let settled = false;

    const fail = (side: EmbeddingSide, error: unknown) => {
      errors[side] = error;
      failed += 1;
      if (failed === 2 && !settled) {
        settled = true;
        reject(new EmbeddingRaceError(errors));
      }
    };

    const start = (side: EmbeddingSide) => {
      let promise: Promise<number[]>;
      try {
        promise = Promise.resolve(calls[side]());
      } catch (error) {
        fail(side, error);
        return;
      }
      promise.then(
        (embedding) => {
          if (!isUsableEmbedding(embedding)) {
            fail(side, new Error('unusable embedding'));
          } else if (!settled) {
            settled = true;
            resolve({ embedding, winner: side });
          }
        },
        (error) => fail(side, error),
      );
    };

    start('local');
    start('remote');
  });
}
