import { createHash } from 'crypto';
import { normalizeQueryText } from '../../search/internal/query-text';
import { AiClassificationSetting } from '../rules/types';

export const CLASSIFY_CACHE_KEY_VERSION = 'v2';

/**
 * classify:v2:{tenant}:{ai on|off}:{model version}:{sha256 of normalized text}
 * - tenant: ml-broker gets tenant_id, and a key without it could hand one
 *   tenant's result to another (ADR 0039 Question 11).
 * - ai: the 'off' request may carry emergency_only, so it is a different request.
 * - No language: the ml-broker request has no language field, so the output
 *   cannot depend on it.
 * - model version: ml-broker reports model_version only in the response, so a
 *   pod keeps the last one it saw (in memory) and puts it in the key. The first
 *   response with a new version switches the key, so a model deploy stops old
 *   results being read (Lucas, 2026-11-18; the TTL is 24 h). Before the first
 *   response the segment is `unknown`. Bump CLASSIFY_CACHE_KEY_VERSION to drop
 *   all entries at once.
 * - The text is hashed: keys never hold search text.
 */
const versionSegment = (v: string | null): string =>
  v ? v.replace(/[^A-Za-z0-9._-]/g, '_') : 'unknown';

export const classifyCacheKey = (
  tenantId: string,
  ai: AiClassificationSetting,
  text: string,
  modelVersion: string | null = null,
): string =>
  `classify:${CLASSIFY_CACHE_KEY_VERSION}:${tenantId}:${ai}:${versionSegment(
    modelVersion,
  )}:${createHash('sha256').update(normalizeQueryText(text)).digest('hex')}`;
