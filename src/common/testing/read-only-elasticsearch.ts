import {
  BaseConnection,
  Client,
  ClientOptions,
  ConnectionRequestParams,
  SniffingTransport,
  Transport,
  TransportRequestOptions,
  TransportRequestParams,
  UndiciConnection,
} from '@elastic/elasticsearch';

/**
 * An Elasticsearch client that can only read, for suites that run against a
 * production cluster. Every request is checked twice before it is sent: once
 * in the Transport, before retries or serialization, and again in the
 * Connection, on the exact method and path that would go on the wire.
 *
 * Allowed: GET and HEAD on any path, and POST to a path whose last segment is
 * `_search`, `_count` or `_mget` (the services' Region existence check). Everything else throws `ReadOnlyViolationError`,
 * including `_bulk`, `_doc` writes, `_update_by_query`, `_delete_by_query`,
 * `_reindex`, index/alias/settings/mapping/pipeline/script changes, scroll and
 * point-in-time.
 */

export class ReadOnlyViolationError extends Error {
  constructor(method: string, path: string) {
    super(`Read-only Elasticsearch client refused ${method} ${path}`);
    this.name = 'ReadOnlyViolationError';
  }
}

export class RequestBudgetExceededError extends Error {
  constructor(budget: number) {
    super(`Request budget of ${budget} Elasticsearch requests exhausted`);
    this.name = 'RequestBudgetExceededError';
  }
}

const READ_POST_ENDPOINTS = new Set(['_search', '_count', '_mget']);

export function isReadOnlyRequest(method: string, path: string): boolean {
  const verb = method.toUpperCase();
  if (verb === 'GET' || verb === 'HEAD') return true;
  if (verb !== 'POST') return false;
  const bare = path.split('?')[0].replace(/\/+$/, '');
  const last = bare.slice(bare.lastIndexOf('/') + 1);
  return READ_POST_ENDPOINTS.has(last);
}

export function assertReadOnlyRequest(method: string, path: string): void {
  if (!isReadOnlyRequest(method, path)) {
    throw new ReadOnlyViolationError(method, path);
  }
}

type ConnectionClass = typeof BaseConnection;
type TransportClass = typeof Transport;

export function readOnlyConnection(Base: ConnectionClass): ConnectionClass {
  class ReadOnlyConnection extends Base {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    request(params: ConnectionRequestParams, options: any): any {
      assertReadOnlyRequest(params.method, params.path);
      return super.request(params, options);
    }
  }
  return ReadOnlyConnection;
}

export interface RequestMeter {
  /** Requests the Transport let through. */
  sent: number;
  /** Every request the Transport let through, in order. */
  log: { method: string; path: string }[];
}

export function readOnlyTransport(
  Base: TransportClass,
  meter: RequestMeter,
  budget: number,
): TransportClass {
  class ReadOnlyTransport extends Base {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    request(
      params: TransportRequestParams,
      options?: TransportRequestOptions,
    ): any {
      assertReadOnlyRequest(params.method, params.path);
      if (meter.sent >= budget) throw new RequestBudgetExceededError(budget);
      meter.sent += 1;
      meter.log.push({ method: params.method, path: params.path });
      return super.request(params, options);
    }
  }
  return ReadOnlyTransport;
}

export interface ReadOnlyClientOptions extends ClientOptions {
  /** Hard cap on requests; the next one throws. Default: unlimited. */
  budget?: number;
}

export function createReadOnlyClient(options: ReadOnlyClientOptions): {
  client: Client;
  meter: RequestMeter;
} {
  const { budget = Number.POSITIVE_INFINITY, ...rest } = options;
  const meter: RequestMeter = { sent: 0, log: [] };
  const client = new Client({
    ...rest,
    Transport: readOnlyTransport(
      rest.Transport ?? SniffingTransport,
      meter,
      budget,
    ),
    Connection: readOnlyConnection(rest.Connection ?? UndiciConnection),
  });
  return { client, meter };
}
