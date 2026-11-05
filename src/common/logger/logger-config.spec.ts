import pino from 'pino';
import { Span, TraceFlags, trace } from '@opentelemetry/api';
import {
  REDACT_CENSOR,
  buildLoggerOptions,
  traceFields,
} from './logger-config';

function logLine(
  options: pino.LoggerOptions,
  fn: (logger: pino.Logger) => void,
): Record<string, unknown> {
  let line: string | undefined;
  const logger = pino(options, {
    write(chunk: string) {
      line = chunk;
    },
  });
  fn(logger);
  expect(line).toBeDefined();
  return JSON.parse(line as string);
}

describe('logger config', () => {
  describe('traceFields', () => {
    it('returns undefined when no span is active', () => {
      expect(traceFields()).toBeUndefined();
    });

    it('returns snake_case trace fields from the active span', () => {
      const spanContext = {
        traceId: '11111111111111111111111111111111',
        spanId: '2222222222222222',
        traceFlags: TraceFlags.SAMPLED,
        isRemote: false,
        traceState: undefined,
      };
      const span = {
        spanContext: () => spanContext,
      } as unknown as Span;

      jest.spyOn(trace, 'getActiveSpan').mockReturnValue(span);
      try {
        expect(traceFields()).toEqual({
          trace_id: '11111111111111111111111111111111',
          span_id: '2222222222222222',
          trace_flags: '01',
        });
      } finally {
        jest.restoreAllMocks();
      }
    });
  });

  describe('buildLoggerOptions', () => {
    it('maps LOG_LEVEL to pino levels', () => {
      const options = buildLoggerOptions('log').pinoHttp as pino.LoggerOptions;
      expect(options.level).toBe('info');
      expect(
        (buildLoggerOptions('verbose').pinoHttp as pino.LoggerOptions).level,
      ).toBe('trace');
      expect(
        (buildLoggerOptions('debug').pinoHttp as pino.LoggerOptions).level,
      ).toBe('debug');
      expect(
        (buildLoggerOptions('warn').pinoHttp as pino.LoggerOptions).level,
      ).toBe('warn');
      expect(
        (buildLoggerOptions('error').pinoHttp as pino.LoggerOptions).level,
      ).toBe('error');
      expect(
        (buildLoggerOptions('nonsense').pinoHttp as pino.LoggerOptions).level,
      ).toBe('warn');
    });

    it('emits one JSON object per line with string level and ISO time and msg key', () => {
      const line = logLine(
        buildLoggerOptions('log').pinoHttp as pino.LoggerOptions,
        (logger) => logger.warn('hello'),
      );
      expect(line.level).toBe('warn');
      expect(line.msg).toBe('hello');
      expect(line.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('mixin adds trace fields when a span is active', () => {
      const spanContext = {
        traceId: '33333333333333333333333333333333',
        spanId: '4444444444444444',
        traceFlags: TraceFlags.SAMPLED,
        isRemote: false,
        traceState: undefined,
      };
      jest.spyOn(trace, 'getActiveSpan').mockReturnValue({
        spanContext: () => spanContext,
      } as never);
      try {
        const line = logLine(
          buildLoggerOptions('log').pinoHttp as pino.LoggerOptions,
          (logger) => logger.info('with span'),
        );
        expect(line.trace_id).toBe('33333333333333333333333333333333');
        expect(line.span_id).toBe('4444444444444444');
        expect(line.trace_flags).toBe('01');
      } finally {
        jest.restoreAllMocks();
      }
    });

    it('mixin adds nothing without an active span', () => {
      const line = logLine(
        buildLoggerOptions('log').pinoHttp as pino.LoggerOptions,
        (logger) => logger.info('no span'),
      );
      expect(line.trace_id).toBeUndefined();
      expect(line.span_id).toBeUndefined();
    });

    it('redacts credentials, cookies and query values', () => {
      const options = buildLoggerOptions('log').pinoHttp as pino.LoggerOptions;
      const redactOptions = { ...options } as Record<string, unknown>;
      delete redactOptions.serializers;
      const redactConfig = (options as Record<string, unknown>).redact as {
        paths: string[];
        censor: string;
      };
      expect(redactConfig.paths).toEqual(
        expect.arrayContaining([
          'req.headers.authorization',
          'req.headers["x-api-key"]',
          'req.headers["x-internal-api-key"]',
          'req.headers.cookie',
          'req.query',
          'req.params.query',
        ]),
      );
      expect(redactConfig.censor).toBe(REDACT_CENSOR);

      // The req serializer intentionally drops headers; redaction is the
      // backstop, so test it with the serializers out of the way.
      const redacted = logLine(redactOptions as pino.LoggerOptions, (logger) =>
        logger.info({
          req: {
            method: 'GET',
            headers: {
              authorization: 'Bearer secret',
              'x-api-key': 'secret-key',
              'x-internal-api-key': 'internal-secret',
              cookie: 'session=secret',
            },
            query: { query: 'suicide help' },
            params: { query: 'crisis' },
          },
        }),
      );
      const req = redacted.req as Record<string, unknown>;
      expect(req.headers).toEqual({
        authorization: '[redacted]',
        'x-api-key': '[redacted]',
        'x-internal-api-key': '[redacted]',
        cookie: '[redacted]',
      });
      expect(req.query).toBe('[redacted]');
      expect(req.params).toEqual({ query: '[redacted]' });
      expect(JSON.stringify(redacted)).not.toMatch(/secret|suicide|crisis/);
    });

    it('req serializer logs method, path-only url, id and tenant header', () => {
      const options = buildLoggerOptions('log').pinoHttp as pino.LoggerOptions;
      const serializers = options.serializers as {
        req: (req: Record<string, unknown>) => Record<string, unknown>;
      };
      const out = serializers.req({
        method: 'POST',
        url: '/v1/search?query=help%20me&lang=de',
        id: 'req-1',
        headers: { 'x-tenant-id': 'tenant-a' },
      });
      expect(out).toEqual({
        method: 'POST',
        url: '/v1/search',
        id: 'req-1',
        tenant_id: 'tenant-a',
      });
      expect(JSON.stringify(out)).not.toContain('help%20me');
    });

    it('keeps autoLogging off', () => {
      const options = buildLoggerOptions('log').pinoHttp as Record<
        string,
        unknown
      >;
      expect(options.autoLogging).toBe(false);
    });
  });
});
