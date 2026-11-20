import { createHash } from 'crypto';
import { BadRequestException } from '@nestjs/common';

/** Search rejects a longer query (v1 and v2). Counted in UTF-16 units, like Elasticsearch. */
export const MAX_QUERY_LENGTH = 500;

export const QUERY_TOO_LONG_MESSAGE = `query must be at most ${MAX_QUERY_LENGTH} characters. Send a short description of the need, not a transcript.`;

export function assertQueryLength(query: string): void {
  if (query.length > MAX_QUERY_LENGTH) {
    throw new BadRequestException(QUERY_TOO_LONG_MESSAGE);
  }
}

/**
 * What the logs may say about a query: its length and a stable fingerprint for
 * matching log lines to each other. Never any of the text: a long query can be
 * a pasted conversation with personal data.
 */
export function describeQueryForLog(query: string): string {
  const id = createHash('sha256').update(query).digest('hex').slice(0, 12);
  return `len=${query.length} id=${id}`;
}
