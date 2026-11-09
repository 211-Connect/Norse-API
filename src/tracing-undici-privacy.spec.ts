import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace';

jest.mock('dotenv/config', () => ({}));

const SECRET = 'SECRET-OPENCAGE-KEY';
const ADDRESS = 'PRIVATE-ADDRESS-123';

/**
 * Regression test for the OpenCage leak: `instrumentation-undici` is enabled by
 * default and records `url.full` (API key + address in the query string) on
 * every span created by global `fetch`. The configured SDK must overwrite those
 * attributes through the shared URL sanitizer.
 */
describe('outbound fetch spans (instrumentation-undici)', () => {
  const exporter = new InMemorySpanExporter();
  const spanProcessor = new SimpleSpanProcessor({ exporter });
  let tracing: typeof import('./tracing');
  let sdk: NodeSDK;
  let server: Server;

  beforeAll(async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    tracing = require('./tracing') as typeof import('./tracing');

    sdk = new NodeSDK({
      resource: tracing.buildServiceResource({}),
      metricReaders: [],
      logRecordProcessors: [],
      spanProcessors: [spanProcessor],
      instrumentations: tracing.buildServiceInstrumentations(),
    });
    sdk.start();

    server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', () => resolve()),
    );
  });

  afterAll(async () => {
    await sdk.shutdown();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it('keeps the query string out of every fetch span attribute and name', async () => {
    const { port } = server.address() as AddressInfo;

    await fetch(
      `http://127.0.0.1:${port}/geocode/v1/json?key=${SECRET}&q=${ADDRESS}`,
    );
    await spanProcessor.forceFlush();

    const spans = exporter.getFinishedSpans();
    expect(spans.length).toBeGreaterThan(0);

    const clientSpan = spans.find(
      (span) => span.attributes['url.full'] !== undefined,
    );
    expect(clientSpan).toBeDefined();
    expect(clientSpan?.attributes['url.full']).toBe(
      `http://127.0.0.1:${port}/geocode/v1/json`,
    );
    expect(clientSpan?.attributes['url.query']).toBe('');

    for (const span of spans) {
      expect(span.name).not.toContain(SECRET);
      expect(span.name).not.toContain(ADDRESS);
      expect(span.name).not.toContain('?');
      for (const value of Object.values(span.attributes)) {
        const rendered = String(value);
        expect(rendered).not.toContain(SECRET);
        expect(rendered).not.toContain(ADDRESS);
        expect(rendered).not.toContain('?');
      }
    }
  });

  it('sanitizes undici-shaped requests through the shared helper', () => {
    const attributes: Record<string, unknown> = {};
    const span = {
      setAttribute: (key: string, value: unknown) => {
        attributes[key] = value;
      },
    };

    tracing.sanitizeRequestUrlAttributes(span as never, {
      origin: 'https://api.opencagedata.com',
      path: `/geocode/v1/json?key=${SECRET}&q=${ADDRESS}`,
    });

    expect(attributes['url.path']).toBe('/geocode/v1/json');
    expect(attributes['url.query']).toBe('');
    expect(attributes['url.full']).toBe(
      'https://api.opencagedata.com/geocode/v1/json',
    );
  });
});
