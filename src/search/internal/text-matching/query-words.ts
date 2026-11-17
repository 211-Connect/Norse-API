/** Lowercased, accent-folded, apostrophe-free words of at least two characters, deduped. */
export function queryWords(q: string): string[] {
  const tokens = q
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/['’]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2);
  return [...new Set(tokens)];
}
