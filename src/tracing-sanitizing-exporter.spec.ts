import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace';

import {
  SanitizingSpanExporter,
  sanitizeSpanName,
  stripUrlQueryAndFragment,
} from './tracing-sanitizing-exporter';

function fakeSpan(
  name: string,
  attributes: Record<string, unknown>,
): ReadableSpan {
  return { name, attributes } as unknown as ReadableSpan;
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

  it('delegates shutdown and forceFlush', async () => {
    const { exporter, calls } = fakeDelegate();
    const sanitizing = new SanitizingSpanExporter(exporter);

    await sanitizing.forceFlush();
    await sanitizing.shutdown();

    expect(calls).toEqual(['forceFlush', 'shutdown']);
  });
});
