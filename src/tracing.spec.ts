import type { ClientRequest, IncomingMessage } from 'node:http';
import type { Span } from '@opentelemetry/api';

jest.mock('dotenv/config', () => ({}));

function loadTracingModule(): typeof import('./tracing') {
  let mod: typeof import('./tracing');
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('./tracing');
  });
  return mod!;
}

function captureSpan(): { attributes: Record<string, unknown>; span: Span } {
  const attributes: Record<string, unknown> = {};
  const span = {
    setAttribute: (key: string, value: unknown) => {
      attributes[key] = value;
    },
  } as unknown as Span;
  return { attributes, span };
}

describe('tracing', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
    jest.unmock('@opentelemetry/sdk-node');
    jest.unmock('@opentelemetry/exporter-trace-otlp-http');
    jest.restoreAllMocks();
  });

  describe('buildServiceResource', () => {
    it('uses the service, version, environment and instance from env', () => {
      const mod = loadTracingModule();

      const attributes = mod.buildServiceResource({
        APP_VERSION: '2.3.4',
        DEPLOYMENT_ENVIRONMENT: 'dev',
        HOSTNAME: 'norse-api-dev-7d9f8c6b5-x2k4m',
      }).attributes;

      expect(attributes['service.name']).toBe('norse-api');
      expect(attributes['service.version']).toBe('2.3.4');
      expect(attributes['deployment.environment.name']).toBe('dev');
      expect(attributes['service.instance.id']).toBe(
        'norse-api-dev-7d9f8c6b5-x2k4m',
      );
    });

    it('defaults to production, the package version and a random instance id', () => {
      const mod = loadTracingModule();

      const attributes = mod.buildServiceResource({}).attributes;

      expect(attributes['service.name']).toBe('norse-api');
      expect(attributes['service.version']).toBe('1.0.0');
      expect(attributes['deployment.environment.name']).toBe('production');
      expect(attributes['service.instance.id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(
        mod.buildServiceResource({}).attributes['service.instance.id'],
      ).not.toBe(attributes['service.instance.id']);
    });
  });

  describe('resolveTraceExporterUrl', () => {
    it('appends /v1/traces to the OTLP base endpoint', () => {
      const mod = loadTracingModule();

      expect(
        mod.resolveTraceExporterUrl({
          OTEL_EXPORTER_OTLP_ENDPOINT: 'http://alloy.monitoring.svc:4318',
        }),
      ).toBe('http://alloy.monitoring.svc:4318/v1/traces');
      expect(
        mod.resolveTraceExporterUrl({
          OTEL_EXPORTER_OTLP_ENDPOINT: 'http://alloy.monitoring.svc:4318/',
        }),
      ).toBe('http://alloy.monitoring.svc:4318/v1/traces');
    });

    it('honours OTEL_EXPORTER_OTLP_TRACES_ENDPOINT verbatim', () => {
      const mod = loadTracingModule();

      expect(
        mod.resolveTraceExporterUrl({
          OTEL_EXPORTER_OTLP_ENDPOINT: 'http://ignored:4318',
          OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'https://otel.example/v1/traces',
        }),
      ).toBe('https://otel.example/v1/traces');
    });

    it('returns undefined when no endpoint is configured', () => {
      const mod = loadTracingModule();

      expect(mod.resolveTraceExporterUrl({})).toBeUndefined();
      expect(
        mod.resolveTraceExporterUrl({ OTEL_EXPORTER_OTLP_ENDPOINT: '   ' }),
      ).toBeUndefined();
    });
  });

  describe('isUsableEndpointUrl', () => {
    it('accepts http(s) URLs and rejects anything else', () => {
      const mod = loadTracingModule();

      expect(mod.isUsableEndpointUrl('http://alloy:4318/v1/traces')).toBe(true);
      expect(mod.isUsableEndpointUrl('https://otlp.c211.io/v1/traces')).toBe(
        true,
      );
      expect(mod.isUsableEndpointUrl('not a url')).toBe(false);
      expect(mod.isUsableEndpointUrl('alloy:4318/v1/traces')).toBe(false);
      expect(mod.isUsableEndpointUrl('ftp://alloy:4318/v1/traces')).toBe(false);
    });
  });

  describe('sanitizeRequestUrlAttributes', () => {
    const serverRequest = {
      url: '/v1/search?query=homeless%20shelter&lat=43.65&lng=-79.38',
      headers: { host: 'api.c211.io' },
      socket: { encrypted: false },
    } as unknown as IncomingMessage;

    const clientRequest = {
      path: '/services/_search?q=homeless%20shelter',
      host: 'elasticsearch',
      protocol: 'http:',
      getHeader: (name: string) =>
        name === 'host' ? 'elasticsearch:9200' : undefined,
    } as unknown as ClientRequest;

    it('keeps only the path on server spans', () => {
      const mod = loadTracingModule();
      const { attributes, span } = captureSpan();

      mod.sanitizeRequestUrlAttributes(span, serverRequest);

      expect(attributes['url.path']).toBe('/v1/search');
      expect(attributes['http.target']).toBe('/v1/search');
      expect(attributes['url.query']).toBe('');
      expect(attributes['url.full']).toBe('http://api.c211.io/v1/search');
      expect(attributes['http.url']).toBe('http://api.c211.io/v1/search');
      for (const value of Object.values(attributes)) {
        expect(String(value)).not.toContain('?');
        expect(String(value)).not.toContain('homeless');
      }
    });

    it('keeps only the path on client spans', () => {
      const mod = loadTracingModule();
      const { attributes, span } = captureSpan();

      mod.sanitizeRequestUrlAttributes(span, clientRequest);

      expect(attributes['url.path']).toBe('/services/_search');
      expect(attributes['url.query']).toBe('');
      expect(attributes['url.full']).toBe(
        'http://elasticsearch:9200/services/_search',
      );
      for (const value of Object.values(attributes)) {
        expect(String(value)).not.toContain('?');
        expect(String(value)).not.toContain('homeless');
      }
    });

    it('uses x-forwarded-proto for the origin behind Envoy', () => {
      const mod = loadTracingModule();
      const { attributes, span } = captureSpan();

      mod.sanitizeRequestUrlAttributes(span, {
        url: '/health?probe=1',
        headers: { host: 'api.c211.io', 'x-forwarded-proto': 'https' },
        socket: { encrypted: false },
      } as unknown as IncomingMessage);

      expect(attributes['url.full']).toBe('https://api.c211.io/health');
    });
  });

  it('registers no SIGTERM handler and shutdownTracing resolves when tracing is disabled', async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
    const before = process.listenerCount('SIGTERM');

    const mod = loadTracingModule();

    expect(process.listenerCount('SIGTERM')).toBe(before);
    await expect(mod.shutdownTracing()).resolves.toBeUndefined();
  });

  it('starts without tracing when the endpoint is not a valid URL', () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'not a url';
    const constructor = jest.fn();
    jest.doMock('@opentelemetry/sdk-node', () => ({
      NodeSDK: class {
        constructor(config: unknown) {
          constructor(config);
        }
        start = jest.fn();
        shutdown = jest.fn().mockResolvedValue(undefined);
      },
    }));
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});

    let mod: typeof import('./tracing') | undefined;
    expect(() => {
      mod = loadTracingModule();
    }).not.toThrow();

    expect(constructor).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      'Tracing disabled: invalid OpenTelemetry exporter endpoint (expected an http(s) URL)',
    );
    return expect(mod!.shutdownTracing()).resolves.toBeUndefined();
  });

  it('wires the exporter, resource and service name; shutdownTracing is idempotent', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://127.0.0.1:4318/';
    delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
    const start = jest.fn();
    const shutdown = jest.fn().mockResolvedValue(undefined);
    const configs: Array<{
      serviceName?: string;
      resource: { attributes: Record<string, unknown> };
    }> = [];
    jest.doMock('@opentelemetry/sdk-node', () => ({
      NodeSDK: class {
        constructor(config: (typeof configs)[number]) {
          configs.push(config);
        }
        start = start;
        shutdown = shutdown;
      },
    }));
    const exporterOptions: Array<{ url?: string }> = [];
    jest.doMock('@opentelemetry/exporter-trace-otlp-http', () => ({
      OTLPTraceExporter: class {
        constructor(options: { url?: string }) {
          exporterOptions.push(options);
        }
      },
    }));
    const before = process.listenerCount('SIGTERM');

    const mod = loadTracingModule();

    expect(process.listenerCount('SIGTERM')).toBe(before);
    expect(start).toHaveBeenCalledTimes(1);
    expect(exporterOptions[0].url).toBe('http://127.0.0.1:4318/v1/traces');
    expect(configs[0].serviceName).toBe('norse-api');
    expect(configs[0].resource.attributes['service.name']).toBe('norse-api');
    expect(configs[0].resource.attributes['deployment.environment.name']).toBe(
      'production',
    );

    await expect(mod.shutdownTracing()).resolves.toBeUndefined();
    await expect(mod.shutdownTracing()).resolves.toBeUndefined();
    expect(shutdown).toHaveBeenCalledTimes(1);
  });
});
