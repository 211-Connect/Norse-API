import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace';

type ExportResultCallback = Parameters<SpanExporter['export']>[1];

/**
 * Attributes that can carry a query string or fragment. `instrumentation-http`
 * and `instrumentation-undici` write the first two; the Nest instrumentation
 * writes `url.full` from `req.originalUrl` on every `Controller.method` span.
 */
const URL_ATTRIBUTES = ['url.full', 'http.url', 'http.target'] as const;

/** `url.query` is dropped entirely — an empty value is still a place to look. */
const DROPPED_ATTRIBUTES = ['url.query'] as const;

/**
 * Strips the query string and the fragment from a URL-ish string.
 * Shared by the request hooks and the exporter backstop.
 */
export function stripUrlQueryAndFragment(value: string): string {
  const cut = value.search(/[?#]/);
  return cut === -1 ? value : value.slice(0, cut);
}

/** Span names sometimes embed the request line (`GET /search?query=...`). */
export function sanitizeSpanName(name: string): string {
  const stripped = stripUrlQueryAndFragment(name).trim();
  return stripped.length > 0 ? stripped : name;
}

/**
 * Privacy rule for exported spans: no query string and no fragment survives in
 * a URL attribute or in the span name, and `url.query` is dropped.
 *
 * Mutates the span in place so every processor/exporter downstream sees the
 * sanitised value; the export path runs after the span has ended.
 */
export function sanitizeExportedSpan(span: ReadableSpan): void {
  // ReadableSpan declares its fields readonly; sanitising happens on the export
  // path, after the span ended, so the mutable view is the whole point here.
  const mutableSpan: { name: string; attributes: Record<string, unknown> } =
    span as unknown as { name: string; attributes: Record<string, unknown> };
  const { attributes } = mutableSpan;

  for (const key of URL_ATTRIBUTES) {
    const value = attributes[key];
    if (typeof value !== 'string') continue;
    const sanitized = stripUrlQueryAndFragment(value);
    if (sanitized !== value) {
      attributes[key] = sanitized;
    }
  }

  for (const key of DROPPED_ATTRIBUTES) {
    delete attributes[key];
  }

  const name = sanitizeSpanName(mutableSpan.name);
  if (name !== mutableSpan.name) {
    mutableSpan.name = name;
  }
}

/**
 * In-process backstop for the span attribute privacy rule.
 *
 * The per-instrumentation `requestHook`s stop `instrumentation-http` and
 * `instrumentation-undici` from ever writing the query string. They cannot see
 * the `url.full` that `instrumentation-nestjs-core` builds from
 * `req.originalUrl` on `nestjs.type=request_context` spans, so this decorator
 * sanitises every span on its way out of the process. It also keeps the rule
 * true when `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` points straight at Tempo,
 * where the collector's privacy processor does not run.
 */
export class SanitizingSpanExporter implements SpanExporter {
  constructor(private readonly delegate: SpanExporter) {}

  export(spans: ReadableSpan[], resultCallback: ExportResultCallback): void {
    for (const span of spans) {
      sanitizeExportedSpan(span);
    }
    this.delegate.export(spans, resultCallback);
  }

  shutdown(): Promise<void> {
    return this.delegate.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.delegate.forceFlush
      ? this.delegate.forceFlush()
      : Promise.resolve();
  }
}
