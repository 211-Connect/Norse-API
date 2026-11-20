import {
  EmbeddingRaceError,
  isUsableEmbedding,
  raceEmbeddings,
} from './embedding-race';

const later = <T>(ms: number, v: T, fail = false): Promise<any> =>
  new Promise<T>((res, rej) => setTimeout(() => (fail ? rej(v) : res(v)), ms));

describe('isUsableEmbedding', () => {
  it('accepts finite number arrays only', () => {
    expect(isUsableEmbedding([0.1, -2])).toBe(true);
    expect(isUsableEmbedding([])).toBe(false);
    expect(isUsableEmbedding([NaN])).toBe(false);
    expect(isUsableEmbedding([Infinity])).toBe(false);
    expect(isUsableEmbedding(['1'])).toBe(false);
    expect(isUsableEmbedding(undefined)).toBe(false);
    expect(isUsableEmbedding('abc')).toBe(false);
  });
});

describe('raceEmbeddings', () => {
  it('faster good local side wins', async () => {
    const r = await raceEmbeddings({
      local: () => later(5, [1]),
      remote: () => later(40, [2]),
    });
    expect(r).toEqual({ embedding: [1], winner: 'local' });
  });

  it('faster good remote side wins', async () => {
    const r = await raceEmbeddings({
      local: () => later(40, [1]),
      remote: () => later(5, [2]),
    });
    expect(r).toEqual({ embedding: [2], winner: 'remote' });
  });

  it.each([[[]], [[NaN]]])(
    'fast unusable %p loses to slow good',
    async (bad) => {
      const r = await raceEmbeddings({
        local: () => later(5, bad as number[]),
        remote: () => later(30, [2]),
      });
      expect(r.winner).toBe('remote');
    },
  );

  it('fast rejection loses to slow good', async () => {
    const r = await raceEmbeddings({
      local: () => later(5, new Error('down'), true),
      remote: () => later(30, [2]),
    });
    expect(r).toEqual({ embedding: [2], winner: 'remote' });
  });

  it('both fail gives EmbeddingRaceError with both messages', async () => {
    const err = await raceEmbeddings({
      local: () => Promise.reject(new Error('tei down')),
      remote: () => later(5, new Error('router 500'), true),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(EmbeddingRaceError);
    expect(err.name).toBe('EmbeddingRaceError');
    expect(err.message).toBe('local: tei down; remote: router 500');
    expect((err.errors.local as Error).message).toBe('tei down');
    expect((err.errors.remote as Error).message).toBe('router 500');
  });

  it('unusable on both sides fails', async () => {
    const err = await raceEmbeddings({
      local: () => Promise.resolve([]),
      remote: () => Promise.resolve([NaN]),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(EmbeddingRaceError);
    expect(err.message).toContain('unusable embedding');
  });

  it('a synchronous throw counts as a failure of that side', async () => {
    const r = await raceEmbeddings({
      local: () => {
        throw new Error('sync');
      },
      remote: () => later(5, [2]),
    });
    expect(r.winner).toBe('remote');
  });

  it('starts both calls before awaiting', () => {
    const local = jest.fn(() => later(5, [1]));
    const remote = jest.fn(() => later(5, [2]));
    const p = raceEmbeddings({ local, remote });
    expect(local).toHaveBeenCalledTimes(1);
    expect(remote).toHaveBeenCalledTimes(1);
    return p;
  });

  it('a loser rejecting after the win causes no unhandled rejection', async () => {
    const spy = jest.fn();
    process.on('unhandledRejection', spy);
    try {
      const r = await raceEmbeddings({
        local: () => later(1, [1]),
        remote: () => later(15, new Error('late'), true),
      });
      expect(r.winner).toBe('local');
      await later(30, null);
      await new Promise((res) => setImmediate(res));
      expect(spy).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', spy);
    }
  });
});
