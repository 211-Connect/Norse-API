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

// `src/tracing` runs `dotenv/config`, and dotenv does not override a variable
// that is already defined. Deleting the keys would let a developer `.env` with
// a real OTLP endpoint re-enable tracing inside the probe and export
// PRIVATE-SEARCH-TEXT to that endpoint; empty strings are defined, so the
// service sees "tracing disabled" and never starts an SDK.
process.env.OTEL_EXPORTER_OTLP_ENDPOINT = '';
process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = '';

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
  // Dynamic imports keep the service modules' top-level side effects after the
  // environment assignments above: `src/tracing` starts its own SDK when an
  // exporter endpoint is configured, so it must not be loaded first.
  // `await import()` compiles to `require()` in CommonJS, so module load order
  // is preserved without the lint-suppressing directive.
  const { buildServiceInstrumentations, buildServiceResource } =
    await import('../../src/tracing');
  const { SanitizingSpanExporter } =
    await import('../../src/tracing-sanitizing-exporter');

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
  // Nest/http instrumentations cannot patch them. Static imports would be
  // hoisted above `sdk.start()`, so `await import()` is required here: it
  // compiles to `require()` at this point in CommonJS and preserves the order.
  const { NestFactory } = await import('@nestjs/core');
  const http = await import('node:http');

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
