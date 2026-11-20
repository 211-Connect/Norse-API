/**
 * Normalizes search text before it is hashed into a cache key AND before it is
 * sent to a model, so a cached value always equals what the model returns for
 * that exact input. Trim and collapse every whitespace run to one space.
 * Case is kept: bge-m3 (embedding) and the ml-broker encoders use cased
 * XLM-R tokenizers, so "AIDS" and "aids" are different inputs.
 */
export const normalizeQueryText = (text: string): string =>
  text.trim().replace(/\s+/g, ' ');
