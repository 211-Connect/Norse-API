/** Code-point string order, for stable tie-breaks. */
export const cmp = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;
