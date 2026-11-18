import { createHash } from 'crypto';
import { normalizeQueryText } from '../../search/internal/query-text';
import { AiClassificationSetting } from '../rules/types';

export const CLASSIFY_CACHE_KEY_VERSION = 'v1';

/**
 * classify:v1:{tenant}:{ai on|off}:{sha256 of normalized text}
 * - tenant: ml-broker gets tenant_id, and a key without it could hand one
 *   tenant's result to another (ADR 0039 Question 11).
 * - ai: the 'off' request may carry emergency_only, so it is a different request.
 * - No language: the ml-broker request has no language field, so the output
 *   cannot depend on it.
 * - No model version: ml-broker reports model_version only in the response, so
 *   it cannot be in a read key. The 59 min TTL bounds staleness after a model
 *   deploy; bump CLASSIFY_CACHE_KEY_VERSION to drop all entries at once.
 * - The text is hashed: keys never hold search text.
 */
export const classifyCacheKey = (
  tenantId: string,
  ai: AiClassificationSetting,
  text: string,
): string =>
  `classify:${CLASSIFY_CACHE_KEY_VERSION}:${tenantId}:${ai}:${createHash(
    'sha256',
  )
    .update(normalizeQueryText(text))
    .digest('hex')}`;
