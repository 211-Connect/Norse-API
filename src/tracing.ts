import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { NodeSDK } from '@opentelemetry/sdk-node';

import {
  defaultResource,
  resourceFromAttributes,
} from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import {
  AlwaysOnSampler,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-node';

let sdk: NodeSDK | undefined;

if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  console.log('Tracing disabled: OTEL_EXPORTER_OTLP_ENDPOINT not defined');
} else {
  console.log(
    'Initializing tracing with endpoint:',
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  );

  sdk = new NodeSDK({
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(
        parseFloat(process.env.OTEL_TRACES_SAMPLER_ARG || '1.0'),
      ),
      remoteParentSampled: new AlwaysOnSampler(),
    }),
    resource: defaultResource().merge(
      resourceFromAttributes({
        [ATTR_SERVICE_NAME]: 'norse-api',
      }),
    ),
    traceExporter: new OTLPTraceExporter({
      url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': {
          enabled: false,
        },
        '@opentelemetry/instrumentation-http': {
          ignoreIncomingRequestHook: (req) => {
            const path = (req.url ?? '').split('?')[0];
            return path === '/metrics' || path === '/health';
          },
        },
      }),
      new NestInstrumentation(),
    ],
  });

  sdk.start();
}

/**
 * Shuts the OpenTelemetry SDK down (flushing the last spans). Idempotent: a
 * second call is a no-op. Called by TracingShutdownService from Nest's
 * onApplicationShutdown hook — do not terminate the process here.
 */
export async function shutdownTracing(): Promise<void> {
  if (!sdk) return;
  const current = sdk;
  sdk = undefined; // idempotent: a second call is a no-op
  try {
    await current.shutdown();
    console.log('Tracing terminated');
  } catch (error) {
    console.log('Error terminating tracing', error);
  }
}
