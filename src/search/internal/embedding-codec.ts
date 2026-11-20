/**
 * Packs an embedding as Float32 little-endian bytes in a base64 string:
 * about 5.5 KB for 1024 numbers, against about 20 KB as JSON. Elasticsearch
 * dense vectors are float32, so the rounding loses nothing that matters.
 */
export const packEmbedding = (vector: number[]): string => {
  const buffer = Buffer.alloc(vector.length * 4);
  vector.forEach((value, i) => buffer.writeFloatLE(value, i * 4));
  return buffer.toString('base64');
};

/** Returns undefined for anything that is not a non-empty packed vector. */
export const unpackEmbedding = (value: unknown): number[] | undefined => {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    return undefined;
  }
  const buffer = Buffer.from(value, 'base64');
  if (buffer.length === 0 || buffer.length % 4 !== 0) return undefined;
  const out: number[] = [];
  for (let i = 0; i < buffer.length; i += 4) {
    const n = buffer.readFloatLE(i);
    if (!Number.isFinite(n)) return undefined;
    out.push(n);
  }
  return out;
};
