import { createHash } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { FieldValue } from '@elastic/elasticsearch/lib/api/types';
import {
  ServiceFilterInput,
  SortMode,
  geoPointKey,
} from './service-search.query';

/**
 * An opaque, unsigned `search_after` cursor. The writer set is the caller's own
 * input, so forging one only moves within results the caller could request; the
 * query fingerprint turns a cursor replayed against another query into a 400.
 */

const CURSOR_VERSION = 1;

export type CursorQuery = ServiceFilterInput & { text?: string };

interface CursorPayload {
  v: number;
  m: SortMode;
  k: string;
  s: FieldValue[];
}

const asSet = (values: readonly string[] | undefined) =>
  [...new Set(values ?? [])].sort();

/**
 * Every query field, required by the mapped type: a new filter field does not
 * compile until it is fingerprinted. Set-like lists are sorted so the same set
 * in another order is the same query (and the same shard preference).
 */
const FINGERPRINT_PARTS: {
  [K in keyof CursorQuery]-?: (query: CursorQuery) => unknown;
} = {
  resourceWriterIds: (q) => asSet(q.resourceWriterIds),
  taxonomyCodes: (q) => asSet(q.taxonomyCodes),
  statuses: (q) => asSet(q.statuses),
  regionIds: (q) => asSet(q.regionIds),
  points: (q) => asSet(q.points?.map(geoPointKey)),
  virtual: (q) => q.virtual ?? 'all',
  text: (q) => q.text?.trim() ?? '',
};

export function queryFingerprint(query: CursorQuery): string {
  const canonical = JSON.stringify(
    Object.entries(FINGERPRINT_PARTS).map(([key, part]) => [key, part(query)]),
  );
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

/**
 * Pinned per query, never per page: primary and replica copies hold different
 * deleted-doc counts, so their BM25 scores drift, and `search_after` on
 * `_score` across copies skips and repeats records.
 */
export function shardPreference(query: CursorQuery): string {
  return `services-${queryFingerprint(query)}`;
}

export function encodeCursor(
  mode: SortMode,
  query: CursorQuery,
  sortValues: FieldValue[],
): string {
  const payload: CursorPayload = {
    v: CURSOR_VERSION,
    m: mode,
    k: queryFingerprint(query),
    s: sortValues,
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

/** The `search_after` values, or a 400 for a cursor this query did not issue. */
export function decodeCursor(
  cursor: string,
  mode: SortMode,
  query: CursorQuery,
): FieldValue[] {
  let payload: CursorPayload;
  try {
    payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  if (
    typeof payload !== 'object' ||
    payload === null ||
    payload.v !== CURSOR_VERSION ||
    payload.m !== mode ||
    payload.k !== queryFingerprint(query) ||
    !validSortValues(mode, payload.s)
  ) {
    throw invalid();
  }
  return payload.s;
}

/** `[name | null, serviceId]` or `[score, serviceId]`; ES returns a missing name as null. */
function validSortValues(mode: SortMode, s: unknown): s is FieldValue[] {
  if (!Array.isArray(s) || s.length !== 2) return false;
  const [first, serviceId] = s;
  if (typeof serviceId !== 'string' || serviceId === '') return false;
  return mode === 'score'
    ? typeof first === 'number' && Number.isFinite(first)
    : first === null || typeof first === 'string';
}

function invalid() {
  return new BadRequestException(
    'Invalid cursor: it must be a nextCursor returned for this same query',
  );
}
