import { createHash } from 'crypto';
import { BadRequestException } from '@nestjs/common';

/** `/v2/search` rejects a longer query; v1 keeps accepting any length. */
export const MAX_V2_QUERY_LENGTH = 500;

const LOG_SNIPPET_CHARS = 40;

export function assertV2QueryLength(query: string): void {
  if (Array.from(query).length > MAX_V2_QUERY_LENGTH) {
    throw new BadRequestException(
      `query must be at most ${MAX_V2_QUERY_LENGTH} characters. Send a short description of the need, not a transcript.`,
    );
  }
}

/**
 * What the logs may say about a query: its length, a stable fingerprint for
 * matching log lines to each other, and the first 40 characters. Never the
 * full text: a long query can be a pasted conversation with personal data.
 */
export function describeQueryForLog(query: string): string {
  const chars = Array.from(query);
  const id = createHash('sha256').update(query).digest('hex').slice(0, 12);
  const start = chars
    .slice(0, LOG_SNIPPET_CHARS)
    .join('')
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ');
  return `len=${chars.length} id=${id} start=${JSON.stringify(start)}`;
}
