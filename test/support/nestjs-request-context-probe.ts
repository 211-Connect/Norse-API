/**
 * Standalone probe for the `instrumentation-nestjs-core` URL leak.
 *
 * Jest replaces Node's module loader, so `require-in-the-middle` never sees
 * `@nestjs/core`/`http` and the Nest instrumentation cannot patch anything (the
 * undici instrumentation works in Jest because it uses `diagnostics_channel`).
 * This script therefore runs in a plain Node process — spawn it from
 * `src/tracing-nestjs-privacy.spec.ts`; it prints the finished spans as JSON.
 *
 * It uses the service's own `buildServiceInstrumentations()`, wraps the
 * in-memory exporter in the production `SanitizingSpanExporter`, and issues
 * `GET /search?query=PRIVATE-SEARCH-TEXT`.
 */
import { Controller, Get, Module } from '@nestjs/common';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace';

delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildServiceInstrumentations, buildServiceResource } =
  require('../../src/tracing') as typeof import('../../src/tracing');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SanitizingSpanExporter } =
  require('../../src/tracing-sanitizing-exporter') as typeof import('../../src/tracing-sanitizing-exporter');

const PRIVATE_SEARCH_TEXT = 'PRIVATE-SEARCH-TEXT';

@Controller('search')
class ProbeController {
  @Get()
  search(): { results: number } {
    return { results: 0 };
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

async function main(): Promise<void> {
  const exporter = new InMemorySpanExporter();
  const spanProcessor = new SimpleSpanProcessor({
    exporter: new SanitizingSpanExporter(exporter),
  });
  const sdk = new NodeSDK({
    resource: buildServiceResource({}),
    metricReaders: [],
    logRecordProcessors: [],
    spanProcessors: [spanProcessor],
    instrumentations: buildServiceInstrumentations(),
  });
  sdk.start();

  // `@nestjs/core` and `http` must be loaded after `sdk.start()`, otherwise the
  // Nest/http instrumentations cannot patch them.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { NestFactory } =
    require('@nestjs/core') as typeof import('@nestjs/core');
  const http = require('node:http') as typeof import('node:http');
  /* eslint-enable @typescript-eslint/no-require-imports */

  const app = await NestFactory.create(ProbeModule, { logger: false });
  await app.listen(0);
  const address = app.getHttpServer().address() as { port: number };

  await new Promise<void>((resolve, reject) => {
    const request = http.request(
      `http://127.0.0.1:${address.port}/search?query=${PRIVATE_SEARCH_TEXT}`,
      (response) => {
        response.resume();
        response.on('end', () => resolve());
      },
    );
    request.on('error', reject);
    request.end();
  });
  await spanProcessor.forceFlush();

  const spans = exporter.getFinishedSpans().map((span) => ({
    name: span.name,
    attributes: span.attributes,
  }));
  await app.close();
  await sdk.shutdown();
  process.stdout.write(`PROBE_SPANS=${JSON.stringify(spans)}\n`);
}

void main().then(
  () => process.exit(0),
  (error: unknown) => {
    process.stderr.write(`${String(error)}\n`);
    process.exit(1);
  },
);
