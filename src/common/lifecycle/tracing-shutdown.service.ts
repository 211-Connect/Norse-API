import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { shutdownTracing } from 'src/tracing';

/**
 * Flushes and stops the OpenTelemetry SDK after every module's onModuleDestroy
 * (e.g. the metrics final push + Pushgateway group delete) has finished.
 * Nest runs onApplicationShutdown after onModuleDestroy on SIGTERM
 * (app.enableShutdownHooks() in main.ts), then re-raises the signal to exit.
 */
@Injectable()
export class TracingShutdownService implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await shutdownTracing();
  }
}
