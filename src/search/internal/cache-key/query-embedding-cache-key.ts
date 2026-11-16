import { createHash } from 'crypto';

/**
 * Key of a cached query embedding. An embedding depends only on the model and
 * the text, so those are the only inputs. The text goes in as a SHA-256 hash:
 * cache keys never hold search text (privacy rule, docs/observability.md).
 * The text is trimmed because the embedding API input is compared by meaning,
 * not by edge whitespace.
 */
export const queryEmbeddingCacheKey = (model: string, text: string): string =>
  `query_embedding:v1:${model}:${createHash('sha256')
    .update(text.trim())
    .digest('hex')}`;
