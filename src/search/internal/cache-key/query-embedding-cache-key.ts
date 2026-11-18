import { createHash } from 'crypto';
import { normalizeQueryText } from '../query-text';

/**
 * Key of a cached query embedding. An embedding depends only on the model and
 * the text, so those are the only inputs. The text goes in as a SHA-256 hash:
 * cache keys never hold search text (privacy rule, docs/observability.md).
 * The text is normalized first (rule in query-text.ts), and the same
 * normalized text is what the embedding API receives.
 */
export const queryEmbeddingCacheKey = (model: string, text: string): string =>
  `query_embedding:v1:${model}:${createHash('sha256')
    .update(normalizeQueryText(text))
    .digest('hex')}`;
