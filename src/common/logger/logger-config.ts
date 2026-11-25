import { Params } from 'nestjs-pino';
import pino from 'pino';
import { trace } from '@opentelemetry/api';
import { DEFAULT_API_VERSION, pathVersionOf } from '../versioning/api-version';

// Nest's LOG_LEVEL values mapped onto pino levels.
const LOG_LEVEL_TO_PINO: Record<string, string> = {
  error: 'error',
  warn: 'warn',
  log: 'info',
  debug: 'debug',
  verbose: 'trace',
};

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers["x-api-key"]',
  'req.headers["x-internal-api-key"]',
  'req.headers.cookie',
  'req.query',
  'req.params.query',
];

export const REDACT_CENSOR = '[redacted]';

/**
 * Adds OpenTelemetry trace correlation to every log line. Only emitted when a
 * valid span is active; snake_case because the collector and Grafana trace-log
 * links use `trace_id`.
 */
export function traceFields(): Record<string, string> | undefined {
  const span = trace.getActiveSpan()?.spanContext();
  if (!span || !trace.isSpanContextValid(span)) {
    return undefined;
  }
  return {
    trace_id: span.traceId,
    span_id: span.spanId,
    trace_flags: span.traceFlags.toString(16).padStart(2, '0'),
  };
}

export function buildLoggerOptions(logLevel: string): Params {
  const level = LOG_LEVEL_TO_PINO[logLevel] ?? 'warn';
  return {
    pinoHttp: {
      level,
      ...(process.env.NODE_ENV === 'development' && {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            ignore: 'context,pid,hostname',
            translateTime: 'SYS:standard',
          },
        },
      }),
      messageKey: 'msg',
      // pino's default timestamp is already ISO 8601.
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label) => ({ level: label }),
      },
      redact: {
        paths: REDACT_PATHS,
        censor: REDACT_CENSOR,
      },
      serializers: {
        // Logs the request URL path only — never the query string (search text).
        req: (req: {
          method?: string;
          url?: string;
          id?: unknown;
          headers?: Record<string, unknown>;
        }) => ({
          method: req.method,
          url: req.url?.split('?')[0],
          // ISS-2496: the legacy unversioned path is v1.
          api_version: pathVersionOf(req.url ?? '') ?? DEFAULT_API_VERSION,
          id: req.id,
          tenant_id: req.headers?.['x-tenant-id'],
        }),
      },
      // Nest's ConsoleLogger did not log per-request access lines, and we keep
      // it that way: services log what matters. Nothing is auto-logged.
      autoLogging: false,
      mixin: () => traceFields() ?? {},
    } as Params['pinoHttp'],
  };
}
