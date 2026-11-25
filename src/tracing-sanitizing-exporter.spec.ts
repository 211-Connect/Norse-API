import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace';

import {
  SanitizingSpanExporter,
  sanitizeSpanName,
  stripUrlQueryAndFragment,
} from './tracing-sanitizing-exporter';

function fakeSpan(
  name: string,
  attributes: Record<string, unknown>,
  events: Array<{ attributes?: Record<string, unknown> }> = [],
  status?: { code: number; message?: string },
): ReadableSpan {
  return { name, attributes, events, status } as unknown as ReadableSpan;
}

function fakeDelegate(): {
  exporter: SpanExporter;
  exported: ReadableSpan[][];
  calls: string[];
} {
  const exported: ReadableSpan[][] = [];
  const calls: string[] = [];
  const exporter: SpanExporter = {
    export: (spans) => {
      exported.push(spans);
    },
    shutdown: () => {
      calls.push('shutdown');
      return Promise.resolve();
    },
    forceFlush: () => {
      calls.push('forceFlush');
      return Promise.resolve();
    },
  };
  return { exporter, exported, calls };
}

describe('SanitizingSpanExporter', () => {
  it('strips the query string and fragment from URL attributes', () => {
    const span = fakeSpan('GET /search', {
      'url.full': 'https://services.c211.io/search?query=PRIVATE#top',
      'http.url': 'https://services.c211.io/search?query=PRIVATE',
      'http.target': '/search?query=PRIVATE',
      'url.query': 'query=PRIVATE',
      'http.request.method': 'GET',
    });
    const { exporter, exported } = fakeDelegate();

    new SanitizingSpanExporter(exporter).export([span], () => undefined);

    expect(exported[0][0].attributes).toEqual({
      'url.full': 'https://services.c211.io/search',
      'http.url': 'https://services.c211.io/search',
      'http.target': '/search',
      'http.request.method': 'GET',
    });
  });

  it('keeps the query string out of the span name', () => {
    const span = fakeSpan('GET /search?query=PRIVATE', {});
    const { exporter, exported } = fakeDelegate();

    new SanitizingSpanExporter(exporter).export([span], () => undefined);

    expect(exported[0][0].name).toBe('GET /search');
    expect(sanitizeSpanName('ProbeController.search')).toBe(
      'ProbeController.search',
    );
    expect(stripUrlQueryAndFragment('/search')).toBe('/search');
  });

  it('drops attributes that are not on the allowlist', () => {
    const span = fakeSpan('GET /test', {
      'custom.thing': 'x',
      'http.route': '/test',
    });
    const { exporter, exported } = fakeDelegate();

    new SanitizingSpanExporter(exporter).export([span], () => undefined);

    expect(exported[0][0].attributes).toEqual({ 'http.route': '/test' });
  });

  it('drops client IPs, user agents and request headers', () => {
    const span = fakeSpan('GET /test', {
      'client.address': '203.0.113.7',
      'user_agent.original': 'Mozilla/5.0',
      'http.request.header.x-api-key': 'secret',
      'http.route': '/test',
    });
    const { exporter, exported } = fakeDelegate();

    new SanitizingSpanExporter(exporter).export([span], () => undefined);

    expect(exported[0][0].attributes).toEqual({ 'http.route': '/test' });
  });

  it('keeps allowlisted instrumentation attributes', () => {
    const span = fakeSpan('GET /test', {
      'http.route': '/test',
      'http.response.status_code': 200,
      'nestjs.controller': 'TestController',
      'db.system': 'redis',
    });
    const { exporter, exported } = fakeDelegate();

    new SanitizingSpanExporter(exporter).export([span], () => undefined);

    expect(exported[0][0].attributes).toEqual({
      'http.route': '/test',
      'http.response.status_code': 200,
      'nestjs.controller': 'TestController',
      'db.system': 'redis',
    });
  });

  it('keeps the pipeline attributes Norse-API sets, and no other custom key', () => {
    const own = {
      'downstream.dependency': 'elasticsearch',
      'downstream.operation': 'hybrid_rrf_keyword',
      'downstream.outcome': 'ok',
      'downstream.took_ms': 12,
      'downstream.server_timing': 'queue;dur=1, predict;dur=80',
      'v2.has_text': true,
      'v2.ai_classification': 'on',
      'v2.boost_needs': 2,
      'v2.selected_needs': 0,
      'v2.count_codes': 3,
      'v2.classify.failed': false,
      'v2.classify.cache_hit': true,
      'hybrid.embed_cache_hit': true,
      'hybrid.typo_clauses': true,
      'hybrid.fused': true,
      'hybrid.fast_page': true,
      'hybrid.cutoff': false,
      'hybrid.need_counts': true,
      // Bounded values only: a side name, a rule category, a U-code.
      'hybrid.embed_winner': 'local',
      'v2.match': 'concentrated',
      'v2.match.name': 'veto_generic',
      'v2.urgency_boost': 'U-2',
    };
    const span = fakeSpan('v2.search', {
      ...own,
      'v2.query': 'search text',
      'downstream.request': 'search text',
    });
    const { exporter, exported } = fakeDelegate();

    new SanitizingSpanExporter(exporter).export([span], () => undefined);

    expect(exported[0][0].attributes).toEqual(own);
  });

  it('reduces statement attributes to the command name', () => {
    const span = fakeSpan('GET /test', {
      'db.query.text': 'GET keyv:geocode:forward:opencage:12 Main St:en:5::',
      'db.statement': 'SET geocode:reverse:1.23,4.56:en:5:: value',
    });
    const { exporter, exported } = fakeDelegate();

    new SanitizingSpanExporter(exporter).export([span], () => undefined);

    expect(exported[0][0].attributes).toEqual({
      'db.query.text': 'GET',
      'db.statement': 'SET',
    });
  });

  it('keeps only exception attributes on events and strips URL queries', () => {
    const span = fakeSpan('GET /search', {}, [
      {
        attributes: {
          'exception.message': 'failed https://x/search?q=food',
          'custom.thing': 'x',
        },
      },
    ]);
    const { exporter, exported } = fakeDelegate();

    new SanitizingSpanExporter(exporter).export([span], () => undefined);

    expect(exported[0][0].events?.[0].attributes).toEqual({
      'exception.message': 'failed https://x/search',
    });
  });

  describe('Mongo spans', () => {
    const SECRET = 'PRIVATE-TEXT';
    const mongoAttributes = (system: string) => ({
      'db.system': system,
      'db.operation': 'insert',
      'db.name': 'probe',
      'db.query.text': `{"insert":"uniqs","documents":[{"name":"${SECRET}"}]}`,
      'db.statement': `{"name":"${SECRET}"}`,
      'otel.status_description': `E11000 duplicate key { name: "${SECRET}" }`,
    });
    const mongoEvents = () => [
      {
        attributes: {
          'exception.type': 'MongoServerError',
          'exception.message': `E11000 duplicate key { name: "${SECRET}" }`,
          'exception.stacktrace': `MongoServerError: dup { name: "${SECRET}" }\n    at x`,
        },
      },
    ];

    it.each(['mongodb', 'mongoose'])(
      'drops statement text, exception message, stack and status text on a %s span',
      (system) => {
        const span = fakeSpan(
          'mongodb.insert',
          mongoAttributes(system),
          mongoEvents(),
          { code: 2, message: `E11000 duplicate key ${SECRET}` },
        );
        const { exporter, exported } = fakeDelegate();

        new SanitizingSpanExporter(exporter).export([span], () => undefined);

        const out = exported[0][0];
        expect(out.attributes).toEqual({
          'db.system': system,
          'db.operation': 'insert',
          'db.name': 'probe',
        });
        expect(out.events[0].attributes).toEqual({
          'exception.type': 'MongoServerError',
        });
        expect(out.status).toEqual({ code: 2 });
        expect(JSON.stringify(out)).not.toContain(SECRET);
      },
    );

    it('treats db.system.name (new semantic convention) the same way', () => {
      const span = fakeSpan(
        'find uniqs',
        { 'db.system.name': 'mongodb', 'db.query.text': `{"a":"${SECRET}"}` },
        mongoEvents(),
        { code: 2, message: SECRET },
      );
      const { exporter, exported } = fakeDelegate();

      new SanitizingSpanExporter(exporter).export([span], () => undefined);

      expect(JSON.stringify(exported[0][0])).not.toContain(SECRET);
    });

    it('scrubs when only one of the two db.system keys says mongodb', () => {
      const span = fakeSpan(
        'find uniqs',
        {
          'db.system.name': 'other',
          'db.system': 'mongodb',
          'db.query.text': `{"a":"${SECRET}"}`,
        },
        mongoEvents(),
        { code: 2, message: SECRET },
      );
      const { exporter, exported } = fakeDelegate();

      new SanitizingSpanExporter(exporter).export([span], () => undefined);

      expect(JSON.stringify(exported[0][0])).not.toContain(SECRET);
    });

    it('leaves other spans unchanged (Redis keeps the command name, errors keep the message)', () => {
      const span = fakeSpan(
        'redis-GET',
        { 'db.system': 'redis', 'db.statement': 'GET some:key' },
        [{ attributes: { 'exception.message': 'boom' } }],
        { code: 2, message: 'boom' },
      );
      const { exporter, exported } = fakeDelegate();

      new SanitizingSpanExporter(exporter).export([span], () => undefined);

      const out = exported[0][0];
      expect(out.attributes).toEqual({
        'db.system': 'redis',
        'db.statement': 'GET',
      });
      expect(out.events[0].attributes).toEqual({ 'exception.message': 'boom' });
      expect(out.status).toEqual({ code: 2, message: 'boom' });
    });
  });

  it('delegates shutdown and forceFlush', async () => {
    const { exporter, calls } = fakeDelegate();
    const sanitizing = new SanitizingSpanExporter(exporter);

    await sanitizing.forceFlush();
    await sanitizing.shutdown();

    expect(calls).toEqual(['forceFlush', 'shutdown']);
  });
});
