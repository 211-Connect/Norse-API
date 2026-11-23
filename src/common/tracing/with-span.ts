import { Attributes, Span, SpanStatusCode, trace } from '@opentelemetry/api';

const TRACER_NAME = 'norse-api';

const markFailed = (span: Span, error: unknown) => {
  span.setStatus({ code: SpanStatusCode.ERROR });
  // The error name only: a message can carry search text (privacy rule,
  // docs/observability.md).
  span.setAttribute(
    'error.type',
    error instanceof Error ? error.name : 'Error',
  );
};

/**
 * Runs `fn` inside a named span that is the active span while `fn` runs, so
 * spans started inside it (HTTP, Elasticsearch, Redis) become its children.
 * Without a tracing endpoint the API hands out a no-op span and this costs
 * nothing. Attributes must never hold search text, coordinates or keys.
 */
export function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Attributes,
): Promise<T> {
  return trace
    .getTracer(TRACER_NAME)
    .startActiveSpan(name, { attributes }, async (span) => {
      try {
        return await fn(span);
      } catch (error) {
        markFailed(span, error);
        throw error;
      } finally {
        span.end();
      }
    });
}

/** `withSpan` for a synchronous step. */
export function withSpanSync<T>(
  name: string,
  fn: (span: Span) => T,
  attributes?: Attributes,
): T {
  return trace
    .getTracer(TRACER_NAME)
    .startActiveSpan(name, { attributes }, (span) => {
      try {
        return fn(span);
      } catch (error) {
        markFailed(span, error);
        throw error;
      } finally {
        span.end();
      }
    });
}
