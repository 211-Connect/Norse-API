import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace';

type ExportResultCallback = Parameters<SpanExporter['export']>[1];

/**
 * Attribute allowlist for exported spans.
 *
 * Norse-API sets no custom span attributes (only instrumentation does), so an
 * allowlist is practical: a future instrumentation upgrade that adds an
 * attribute is dropped by default instead of leaking user input, IPs or
 * headers. Keys not listed here and not matching a prefix below are removed.
 */
const ALLOWED_ATTRIBUTES = [
  'http.request.method',
  'http.request.method_original',
  'http.response.status_code',
  'http.route',
  'http.method',
  'http.status_code',
  'url.scheme',
  'url.path',
  'url.full',
  'http.target',
  'http.url',
  'server.address',
  'server.port',
  'net.peer.name',
  'net.peer.port',
  'peer.service',
  'network.protocol.name',
  'network.protocol.version',
  'network.transport',
  'error.type',
  'component',
  'otel.status_code',
  'otel.status_description',
  'user_agent.synthetic.type',
] as const;

/** Non-sensitive instrumentation families (e.g. `db.system`, `nestjs.type`). */
const ALLOWED_ATTRIBUTE_PREFIXES = [
  'nestjs.',
  'db.',
  'elasticsearch.',
  'code.',
] as const;

/**
 * Never exported even when a prefix would allow it (checked before the
 * allowlist): they carry client IPs, headers, user agents or query text.
 */
const DENIED_ATTRIBUTES = [
  'url.query',
  'client.address',
  'network.peer.address',
  'network.peer.port',
  'http.client_ip',
  'net.peer.ip',
  'peer.address',
  'user_agent.original',
  'http.user_agent',
] as const;

const DENIED_ATTRIBUTE_PREFIXES = [
  'http.request.header.',
  'http.response.header.',
] as const;

/**
 * Attributes that can carry a query string or fragment. `instrumentation-http`
 * and `instrumentation-undici` write `url.full`/`http.target`; the Nest
 * instrumentation writes `url.full` from `req.originalUrl` on every
 * `Controller.method` span; `url.path` is kept query-free too.
 */
const URL_ATTRIBUTES = [
  'url.full',
  'http.url',
  'http.target',
  'url.path',
] as const;

/**
 * Statement attributes keep only the command name: keys and arguments can carry
 * search data (Redis cache keys were built from geocoded addresses).
 */
const STATEMENT_ATTRIBUTES = ['db.query.text', 'db.statement'] as const;

/** Event attributes safe to export from an exception event. */
const ALLOWED_EVENT_ATTRIBUTES = [
  'exception.type',
  'exception.message',
  'exception.stacktrace',
  'exception.escaped',
] as const;

/**
 * Strips the query string and the fragment from a URL-ish string.
 * Shared by the request hooks and the exporter backstop.
 */
export function stripUrlQueryAndFragment(value: string): string {
  const cut = value.search(/[?#]/);
  return cut === -1 ? value : value.slice(0, cut);
}

/**
 * Strips `?…`/`#…` only inside URL-shaped tokens, so a stack trace is not
 * truncated at the first `?` in prose.
 */
function stripQueryInUrlTokens(value: string): string {
  return value.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s]+/gi, (url) =>
    stripUrlQueryAndFragment(url),
  );
}

/** Span names sometimes embed the request line (`GET /search?query=...`). */
export function sanitizeSpanName(name: string): string {
  const stripped = stripUrlQueryAndFragment(name).trim();
  return stripped.length > 0 ? stripped : name;
}

function isAllowedAttribute(key: string): boolean {
  for (const denied of DENIED_ATTRIBUTES) {
    if (key === denied) return false;
  }
  for (const denied of DENIED_ATTRIBUTE_PREFIXES) {
    if (key.startsWith(denied)) return false;
  }
  for (const allowed of ALLOWED_ATTRIBUTES) {
    if (key === allowed) return true;
  }
  for (const prefix of ALLOWED_ATTRIBUTE_PREFIXES) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Privacy rule for exported spans: every attribute must be on the allowlist,
 * no query string or fragment survives in a URL attribute or in the span name,
 * statement attributes keep only the command name, and exception events keep
 * only their `exception.*` attributes (URL query strings stripped).
 *
 * Mutates the span in place so every processor/exporter downstream sees the
 * sanitised value; the export path runs after the span has ended.
 */
export function sanitizeExportedSpan(span: ReadableSpan): void {
  // ReadableSpan declares its fields readonly; sanitising happens on the export
  // path, after the span ended, so the mutable view is the whole point here.
  const mutableSpan: {
    name: string;
    attributes: Record<string, unknown>;
    events?: Array<{ attributes?: Record<string, unknown> }>;
  } = span as unknown as {
    name: string;
    attributes: Record<string, unknown>;
    events?: Array<{ attributes?: Record<string, unknown> }>;
  };
  const { attributes } = mutableSpan;

  for (const key of Object.keys(attributes)) {
    if (!isAllowedAttribute(key)) {
      delete attributes[key];
    }
  }

  for (const key of URL_ATTRIBUTES) {
    const value = attributes[key];
    if (typeof value !== 'string') continue;
    const sanitized = stripUrlQueryAndFragment(value);
    if (sanitized !== value) {
      attributes[key] = sanitized;
    }
  }

  for (const key of STATEMENT_ATTRIBUTES) {
    const value = attributes[key];
    if (typeof value !== 'string') continue;
    attributes[key] = value.trim().split(/\s+/)[0];
  }

  for (const event of mutableSpan.events ?? []) {
    if (!event.attributes) continue;
    const eventAttributes = event.attributes;
    for (const key of Object.keys(eventAttributes)) {
      if (!(ALLOWED_EVENT_ATTRIBUTES as readonly string[]).includes(key)) {
        delete eventAttributes[key];
      }
    }
    for (const key of ALLOWED_EVENT_ATTRIBUTES) {
      const value = eventAttributes[key];
      if (typeof value !== 'string') continue;
      const sanitized = stripQueryInUrlTokens(value);
      if (sanitized !== value) {
        eventAttributes[key] = sanitized;
      }
    }
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
 *
 * Every attribute is filtered through an allowlist: only instrumentation
 * attributes known to be safe are exported, statement attributes keep just the
 * command name, and the query string is stripped from exception messages.
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
