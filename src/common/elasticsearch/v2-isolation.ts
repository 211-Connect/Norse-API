import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Client,
  ClientOptions,
  SniffingTransport,
} from '@elastic/elasticsearch';
import { NextFunction, Request, Response } from 'express';
import { envFlag } from '../config/configuration';

/**
 * The one default of env `ELASTIC_V2_ISOLATION_ENABLED` (any case; read by
 * envFlag). On unless `false`; `false`: v1 and v2 share one client with the
 * library defaults, as before.
 */
export const ELASTIC_V2_ISOLATION_DEFAULT_ON = true;

/**
 * Longest wait for one Elasticsearch call of a v2 request, in ms, time in the
 * socket queue included. The slowest v2 call measured has a p95 of 593 ms
 * (cutoff probe, 2026-11-18), so this cuts a hang, not a slow answer. It stays
 * below the 15 s default route limit of the gateway.
 */
export const ELASTIC_V2_LIMIT_MS = 5000;

/** Set while a /v2 request runs; follows its async calls. */
const v2Scope = new AsyncLocalStorage<true>();

/** Marks every Elasticsearch call of the request as a v2 call. */
@Injectable()
export class V2ElasticScopeMiddleware implements NestMiddleware {
  use(_req: Request, _res: Response, next: NextFunction) {
    v2Scope.run(true, next);
  }
}

/**
 * The options of the one shared client. With the switch on, calls made inside
 * a v2 request go through a second client: its own sockets and a limit per
 * call. Calls outside a v2 request (all of v1, printable directories, jobs)
 * keep today's sockets and no limit.
 */
export function elasticsearchOptions(
  config: Pick<ConfigService, 'get'>,
  limitMs = ELASTIC_V2_LIMIT_MS,
): ClientOptions {
  const base: ClientOptions = {
    node: config.get('ELASTIC_NODE'),
    auth: {
      apiKey: config.get('ELASTIC_API_KEY'),
    },
  };
  if (
    !envFlag(
      config.get<string>('ELASTIC_V2_ISOLATION_ENABLED'),
      ELASTIC_V2_ISOLATION_DEFAULT_ON,
    )
  ) {
    return base;
  }

  // `bodyTimeout` covers an answer that stalls after its headers; the
  // per-call `requestTimeout` below covers the queue and the headers. A
  // client-level `requestTimeout` would not start until a socket is free.
  // The type of `agent` omits this undici Pool option; it is passed through.
  const agent: object = { bodyTimeout: limitMs };
  // Made on the first v2 call: a process that serves no v2 opens nothing.
  let v2Client: Client | undefined;

  class V2IsolatedTransport extends SniffingTransport {
    // Typed loosely: the base method has three overloads.
    async request(params: any, options: any = {}): Promise<any> {
      if (!v2Scope.getStore()) return super.request(params, options);
      v2Client ??= new Client({ ...base, agent });
      return v2Client.transport.request(params, {
        ...options,
        requestTimeout: options.requestTimeout ?? limitMs,
      });
    }
  }
  return { ...base, Transport: V2IsolatedTransport };
}
