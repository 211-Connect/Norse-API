import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

jest.mock('dotenv/config', () => ({}));
jest.mock('@opentelemetry/auto-instrumentations-node', () => ({
  getNodeAutoInstrumentations: jest.fn(() => []),
}));

const PRIVATE_SEARCH_TEXT = 'PRIVATE-SEARCH-TEXT';
const PRIVATE_URL = `/search?query=${PRIVATE_SEARCH_TEXT}`;

interface CapturedSdkConfig {
  traceExporter?: SpanExporter;
}

/**
 * Stands in for the OTLP exporter and records exactly what the SDK hands it,
 * i.e. what a real endpoint would receive.
 */
class RecordingOtlpExporter implements SpanExporter {
  readonly options: { url?: string };
  readonly exportedSpans: Array<{
    name: string;
    attributes: Record<string, unknown>;
  }> = [];

  constructor(options: { url?: string }) {
    this.options = options;
  }

  export(spans: ReadableSpan[]): void {
    for (const span of spans) {
      this.exportedSpans.push({
        name: span.name,
        attributes: { ...span.attributes },
      });
    }
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * The `SanitizingSpanExporter` backstop is the only layer that covers
 * `instrumentation-nestjs-core` spans, so the production wiring in
 * `createSdk` must keep it. The probe used to be the only check, and it wraps
 * the exporter itself — removing the wrapper from `src/tracing.ts` left every
 * suite green.
 */
describe('production tracing wiring', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('builds the SDK with an exporter that sanitises spans before they leave', () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://127.0.0.1:4318';
    delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;

    const configs: CapturedSdkConfig[] = [];
    jest.doMock('@opentelemetry/sdk-node', () => ({
      NodeSDK: class {
        constructor(config: CapturedSdkConfig) {
          configs.push(config);
        }
        start = jest.fn();
        shutdown = jest.fn().mockResolvedValue(undefined);
      },
    }));

    const otlpExporters: RecordingOtlpExporter[] = [];
    jest.doMock('@opentelemetry/exporter-trace-otlp-http', () => ({
      OTLPTraceExporter: class extends RecordingOtlpExporter {
        constructor(options: { url?: string }) {
          super(options);
          otlpExporters.push(this);
        }
      },
    }));

    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./tracing');
    });

    expect(otlpExporters).toHaveLength(1);
    expect(otlpExporters[0].options.url).toBe(
      'http://127.0.0.1:4318/v1/traces',
    );

    const traceExporter = configs[0].traceExporter;
    expect(traceExporter).toBeDefined();
    expect(traceExporter).not.toBe(otlpExporters[0]);

    const span = {
      name: `GET ${PRIVATE_URL}`,
      attributes: {
        'url.full': PRIVATE_URL,
        'url.query': `query=${PRIVATE_SEARCH_TEXT}`,
      },
    } as unknown as ReadableSpan;

    traceExporter!.export([span], () => {});

    expect(otlpExporters[0].exportedSpans).toEqual([
      { name: 'GET /search', attributes: { 'url.full': '/search' } },
    ]);
  });

  it('serializes redis and ioredis statements to the command name only', () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
    (getNodeAutoInstrumentations as jest.Mock).mockClear();

    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const tracing = require('./tracing') as {
        buildServiceInstrumentations: () => unknown;
      };
      tracing.buildServiceInstrumentations();
    });

    const config = (getNodeAutoInstrumentations as jest.Mock).mock.calls[0][0];
    expect(
      config['@opentelemetry/instrumentation-redis'].dbStatementSerializer(
        'GET',
        ['geocode:forward:x'],
      ),
    ).toBe('GET');
    expect(
      config['@opentelemetry/instrumentation-ioredis'].dbStatementSerializer(
        'GET',
        ['geocode:forward:x'],
      ),
    ).toBe('GET');
  });
});
