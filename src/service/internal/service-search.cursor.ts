import { createHash } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { FieldValue } from '@elastic/elasticsearch/lib/api/types';
import { VirtualMode } from './dto';
import { SortMode } from './service-search.query';

/**
 * An opaque `search_after` cursor: the last hit's sort values, the sort mode
 * they belong to, and a fingerprint of the query that produced them.
 *
 * It is not signed; the writer set is the caller's own input, so a forged cursor
 * can only move a position within results the caller could already request.
 * The fingerprint turns a cursor replayed against a different query into a 400
 * instead of a page that silently skips records.
 */

const CURSOR_VERSION = 1;

export interface CursorQuery {
  resourceWriterIds: readonly string[];
  taxonomyCodes?: readonly string[];
  statuses?: readonly string[];
  regionIds?: readonly string[];
  virtual?: VirtualMode;
  text?: string;
}

interface CursorPayload {
  v: number;
  m: SortMode;
  k: string;
  s: FieldValue[];
}

export function queryFingerprint(query: CursorQuery): string {
  const canonical = JSON.stringify([
    query.resourceWriterIds,
    query.taxonomyCodes ?? [],
    query.statuses ?? [],
    query.text?.trim() ?? '',
    query.regionIds ?? [],
    query.virtual ?? 'all',
  ]);
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
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

/**
 * `[name | null, serviceId]` or `[score, serviceId]`. A missing name comes
 * back from ES as null and sorts first, so null is a legal first value.
 */
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
