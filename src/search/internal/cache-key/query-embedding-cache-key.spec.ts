import { queryEmbeddingCacheKey } from './query-embedding-cache-key';

describe('queryEmbeddingCacheKey', () => {
  it('is stable and has the versioned prefix and a sha256 hex tail', () => {
    const key = queryEmbeddingCacheKey('remote', 'model-x', 'food bank');
    expect(key).toBe(queryEmbeddingCacheKey('remote', 'model-x', 'food bank'));
    expect(key).toMatch(/^query_embedding:remote:v1:model-x:[0-9a-f]{64}$/);
  });

  it('never contains the search text', () => {
    const key = queryEmbeddingCacheKey('remote', 'model-x', 'secret words');
    expect(key).not.toContain('secret');
    expect(key).not.toContain('words');
  });

  it('changes with the model and the text, not with edge whitespace', () => {
    const base = queryEmbeddingCacheKey('remote', 'model-x', 'food bank');
    expect(queryEmbeddingCacheKey('remote', 'model-y', 'food bank')).not.toBe(
      base,
    );
    expect(queryEmbeddingCacheKey('remote', 'model-x', 'food banks')).not.toBe(
      base,
    );
    expect(queryEmbeddingCacheKey('remote', 'model-x', '  food bank \n')).toBe(
      base,
    );
  });

  it('treats whitespace runs as one space but keeps case', () => {
    const base = queryEmbeddingCacheKey('remote', 'model-x', 'food bank');
    expect(queryEmbeddingCacheKey('remote', 'model-x', 'food   bank')).toBe(
      base,
    );
    expect(queryEmbeddingCacheKey('remote', 'model-x', 'food\tbank')).toBe(
      base,
    );
    expect(queryEmbeddingCacheKey('remote', 'model-x', 'Food bank')).not.toBe(
      base,
    );
  });

  it('differs by source, so a race answer never reaches a remote-only reader', () => {
    expect(queryEmbeddingCacheKey('race', 'model-x', 'food bank')).not.toBe(
      queryEmbeddingCacheKey('remote', 'model-x', 'food bank'),
    );
  });
});
