import { packEmbedding, unpackEmbedding } from './embedding-codec';

describe('embedding codec', () => {
  it('round-trips to float32 precision', () => {
    const v = [0.1, -0.25, 3.14159, 0, 1e-7];
    const back = unpackEmbedding(packEmbedding(v))!;
    expect(back).toHaveLength(v.length);
    v.forEach((n, i) => expect(back[i]).toBeCloseTo(n, 6));
  });

  it('packs 1024 numbers in about 5.5 KB', () => {
    const v = Array.from({ length: 1024 }, (_, i) => Math.sin(i));
    expect(packEmbedding(v).length).toBe(5464);
  });

  it.each([undefined, null, 42, '', 'not base64!!', 'QUJD', [1, 2]])(
    'rejects %p',
    (bad) => {
      expect(unpackEmbedding(bad)).toBeUndefined();
    },
  );

  it('rejects non-finite values', () => {
    expect(unpackEmbedding(packEmbedding([NaN]))).toBeUndefined();
  });
});
