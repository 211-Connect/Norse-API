import { queryEmbeddingCacheKey } from './query-embedding-cache-key';

describe('queryEmbeddingCacheKey', () => {
  it('is stable and has the versioned prefix and a sha256 hex tail', () => {
    const key = queryEmbeddingCacheKey('model-x', 'food bank');
    expect(key).toBe(queryEmbeddingCacheKey('model-x', 'food bank'));
    expect(key).toMatch(/^query_embedding:v1:model-x:[0-9a-f]{64}$/);
  });

  it('never contains the search text', () => {
    const key = queryEmbeddingCacheKey('model-x', 'secret words');
    expect(key).not.toContain('secret');
    expect(key).not.toContain('words');
  });

  it('changes with the model and the text, not with edge whitespace', () => {
    const base = queryEmbeddingCacheKey('model-x', 'food bank');
    expect(queryEmbeddingCacheKey('model-y', 'food bank')).not.toBe(base);
    expect(queryEmbeddingCacheKey('model-x', 'food banks')).not.toBe(base);
    expect(queryEmbeddingCacheKey('model-x', '  food bank \n')).toBe(base);
  });

  it('treats whitespace runs as one space but keeps case', () => {
    const base = queryEmbeddingCacheKey('model-x', 'food bank');
    expect(queryEmbeddingCacheKey('model-x', 'food   bank')).toBe(base);
    expect(queryEmbeddingCacheKey('model-x', 'food\tbank')).toBe(base);
    expect(queryEmbeddingCacheKey('model-x', 'Food bank')).not.toBe(base);
  });
});
