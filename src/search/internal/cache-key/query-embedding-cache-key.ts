import { createHash } from 'crypto';
import { normalizeQueryText } from '../query-text';

/**
 * Who may have made a cached vector. `remote`: EMBEDDING_BASE_URL only (v2
 * without EMBEDDING_LOCAL_BASE_URL; v1 uses no cache). `race`: v2 with it set, so
 * either side.
 */
export type QueryEmbeddingSource = 'remote' | 'race';

/**
 * Key of a cached query embedding. An embedding depends on the model, the text
 * and the source (two servers give slightly different vectors for one model,
 * and a vector of the local one must not serve a v2 call without it). The source in the prefix
 * also keeps out entries of builds that stored both kinds under one key. The text goes in as a SHA-256 hash:
 * cache keys never hold search text (privacy rule, docs/observability.md).
 * The text is normalized first (rule in query-text.ts), and the same
 * normalized text is what the embedding API receives.
 */
export const queryEmbeddingCacheKey = (
  source: QueryEmbeddingSource,
  model: string,
  text: string,
): string =>
  `query_embedding:${source}:v1:${model}:${createHash('sha256')
    .update(normalizeQueryText(text))
    .digest('hex')}`;
