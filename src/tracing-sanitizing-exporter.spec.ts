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
): ReadableSpan {
  return { name, attributes, events } as unknown as ReadableSpan;
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

  it('delegates shutdown and forceFlush', async () => {
    const { exporter, calls } = fakeDelegate();
    const sanitizing = new SanitizingSpanExporter(exporter);

    await sanitizing.forceFlush();
    await sanitizing.shutdown();

    expect(calls).toEqual(['forceFlush', 'shutdown']);
  });
});
