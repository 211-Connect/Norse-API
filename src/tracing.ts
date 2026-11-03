import 'dotenv/config';

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { join } from 'node:path';

import type { Span } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import {
  defaultResource,
  resourceFromAttributes,
  type Resource,
} from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import type { NodeSDKConfiguration } from '@opentelemetry/sdk-node';
import {
  AlwaysOnSampler,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace';
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_INSTANCE_ID,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

import {
  SanitizingSpanExporter,
  stripUrlQueryAndFragment,
} from './tracing-sanitizing-exporter';

/** Service name used in both the production and the dev namespace. */
export const SERVICE_NAME = 'norse-api';

/**
 * No default on purpose: a wrong `production` label silently hides in Tempo.
 * The deployment must set `DEPLOYMENT_ENVIRONMENT`; without it telemetry is
 * labelled `unknown` and startup logs one warning.
 */
const UNKNOWN_DEPLOYMENT_ENVIRONMENT = 'unknown';

let sdk: NodeSDK | undefined;

function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '..', 'package.json'), 'utf8'),
    ) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const PACKAGE_VERSION = readPackageVersion();

/**
 * Resource describing this pod/process. `deployment.environment.name` separates
 * production from dev — `service.name` stays `norse-api` in both namespaces.
 */
export function buildServiceResource(
  env: NodeJS.ProcessEnv = process.env,
): Resource {
  return defaultResource().merge(
    resourceFromAttributes({
      [ATTR_SERVICE_NAME]: SERVICE_NAME,
      [ATTR_SERVICE_VERSION]:
        env.APP_VERSION?.trim() || PACKAGE_VERSION || '0.0.0',
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]:
        env.DEPLOYMENT_ENVIRONMENT?.trim() || UNKNOWN_DEPLOYMENT_ENVIRONMENT,
      [ATTR_SERVICE_INSTANCE_ID]: env.HOSTNAME?.trim() || randomUUID(),
    }),
  );
}

/**
 * Warns once at startup when the deployment forgot `DEPLOYMENT_ENVIRONMENT`.
 * The message names the variable only — never other environment values.
 */
export function warnIfDeploymentEnvironmentMissing(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!env.DEPLOYMENT_ENVIRONMENT?.trim()) {
    console.warn(
      'DEPLOYMENT_ENVIRONMENT is not set: telemetry is labelled deployment.environment.name=unknown',
    );
  }
}

/**
 * Exporter URL. `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` is honoured verbatim;
 * otherwise the OTLP base endpoint gets the `/v1/traces` suffix. Endpoint
 * agnostic on purpose: the current Tempo endpoint and the wave 2 in-cluster
 * Alloy endpoint only differ in `OTEL_EXPORTER_OTLP_ENDPOINT`.
 */
export function resolveTraceExporterUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const tracesEndpoint = env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim();
  if (tracesEndpoint) return tracesEndpoint;

  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!endpoint) return undefined;

  return `${endpoint.replace(/\/+$/, '')}/v1/traces`;
}

/** Rejects strings that `new URL()` cannot parse or that are not http(s). */
export function isUsableEndpointUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.hostname.length > 0
    );
  } catch {
    return false;
  }
}

function buildBasicAuthHeaders(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> | undefined {
  const username = env.OTEL_EXPORTER_OTLP_USERNAME;
  const password = env.OTEL_EXPORTER_OTLP_PASSWORD;

  if (!username || !password) {
    return undefined;
  }

  return {
    Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
  };
}

function firstHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * Minimal shape shared by every instrumented request: `instrumentation-http`
 * passes `IncomingMessage`/`ClientRequest`, `instrumentation-undici` passes
 * `{ origin, path }` (global `fetch`, the Elasticsearch client, OpenCage).
 */
type UrlBearingRequest =
  ClientRequest | IncomingMessage | { origin: string; path: string };

/** `req.url` on a server request, `req.path` on a client request. */
function getRequestPath(request: UrlBearingRequest): string {
  if ('url' in request && typeof request.url === 'string') {
    return request.url;
  }
  if ('path' in request && typeof request.path === 'string') {
    return request.path;
  }
  return '/';
}

function stripQueryString(path: string): string {
  const withoutQuery = stripUrlQueryAndFragment(path);
  return withoutQuery.length > 0 ? withoutQuery : '/';
}

function getRequestOrigin(request: UrlBearingRequest): string | undefined {
  // instrumentation-undici hands over the request URL split into origin/path.
  if ('origin' in request && typeof request.origin === 'string') {
    return request.origin;
  }
  const httpRequest = request as ClientRequest | IncomingMessage;
  if ('headers' in httpRequest) {
    const host = firstHeaderValue(
      httpRequest.headers.host as string | string[] | undefined,
    );
    if (!host) return undefined;
    const forwardedProto = firstHeaderValue(
      httpRequest.headers['x-forwarded-proto'] as string | string[] | undefined,
    );
    const encrypted =
      'socket' in httpRequest &&
      Boolean(
        (httpRequest.socket as { encrypted?: boolean } | undefined)?.encrypted,
      );
    const protocol = forwardedProto ?? (encrypted ? 'https' : 'http');
    return `${protocol}://${host}`;
  }

  const hostHeader = httpRequest.getHeader('host');
  const host =
    (Array.isArray(hostHeader) ? hostHeader[0] : hostHeader) ||
    httpRequest.host;
  if (!host) return undefined;
  const protocol =
    'protocol' in httpRequest && httpRequest.protocol
      ? httpRequest.protocol
      : 'http:';
  return `${protocol}//${String(host)}`;
}

/**
 * Privacy rule for spans: URL attributes carry the path only, never the query
 * string (search text, locations, coordinates). Applies to incoming server
 * spans and to outgoing client spans alike.
 *
 * instrumentation-http@0.300 sets `url.path`/`url.query` on server spans and
 * `url.full` on client spans; instrumentation-undici sets `url.full`,
 * `url.path` and `url.query` on every client span (including `fetch`, which
 * OpenCage uses). The older `http.target`/`http.url` attributes are still
 * written here so no query string survives under either semconv.
 */
export function sanitizeRequestUrlAttributes(
  span: Span,
  request: UrlBearingRequest,
): void {
  const path = stripQueryString(getRequestPath(request));
  const origin = getRequestOrigin(request);
  const absoluteUrl = origin ? `${origin}${path}` : path;

  span.setAttribute('http.target', path);
  span.setAttribute('url.path', path);
  span.setAttribute('url.query', '');
  span.setAttribute('http.url', absoluteUrl);
  span.setAttribute('url.full', absoluteUrl);
}

export type ServiceInstrumentations = NodeSDKConfiguration['instrumentations'];

/**
 * Instrumentations shared by the running service and the privacy tests.
 * `instrumentation-undici` must be configured explicitly: it is enabled by
 * default by `getNodeAutoInstrumentations` and it writes `url.full`,
 * `url.path` and `url.query` from the real request URL (OpenCage sends the API
 * key and the geocoded address in the query string).
 */
export function buildServiceInstrumentations(): ServiceInstrumentations {
  return [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-express': {
        enabled: false,
      },
      '@opentelemetry/instrumentation-fs': {
        enabled: false,
      },
      '@opentelemetry/instrumentation-dns': {
        enabled: false,
      },
      '@opentelemetry/instrumentation-net': {
        enabled: false,
      },
      '@opentelemetry/instrumentation-http': {
        ignoreIncomingRequestHook: (req) => {
          const path = (req.url ?? '').split('?')[0];
          return path === '/metrics' || path === '/health';
        },
        requestHook: sanitizeRequestUrlAttributes,
      },
      '@opentelemetry/instrumentation-undici': {
        requestHook: sanitizeRequestUrlAttributes,
      },
    }),
    new NestInstrumentation(),
  ];
}

function createSdk(exporterUrl: string): NodeSDK {
  return new NodeSDK({
    // Parent-based sampling: a request that arrives with a `traceparent` keeps
    // the caller's decision (Norse sends -01 sampled / -00 unsampled; Envoy
    // edge tracing samples header-less requests), so the only ratio this
    // service controls is the root one. Production and dev both run at
    // OTEL_TRACES_SAMPLER_ARG=1.0 — keep this sampler unchanged.
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(
        parseFloat(process.env.OTEL_TRACES_SAMPLER_ARG || '1.0'),
      ),
      remoteParentSampled: new AlwaysOnSampler(),
    }),
    resource: buildServiceResource(),
    // NodeSDK merges the detected resources (incl. OTEL_RESOURCE_ATTRIBUTES)
    // on top of `resource`, so pin the service name here as well: it must stay
    // `norse-api` in every environment.
    serviceName: SERVICE_NAME,
    // SDK 3.0 exports metrics and logs over OTLP by default when the exporter
    // env vars are unset. This service exports traces only: logs go to stdout
    // (collected by the Alloy DaemonSet) and metrics are scraped.
    metricReaders: [],
    logRecordProcessors: [],
    // Two layers keep query strings out of traces: the request hooks above stop
    // instrumentation-http/-undici from writing them, and this exporter wrapper
    // is the backstop for spans nobody hooks (instrumentation-nestjs-core puts
    // `req.originalUrl` into `url.full` on every Controller.method span). The
    // backstop also holds when traces go straight to Tempo, i.e. when the
    // collector's privacy processor is not in the path.
    traceExporter: new SanitizingSpanExporter(
      new OTLPTraceExporter({
        url: exporterUrl,
        headers: buildBasicAuthHeaders(),
      }),
    ),
    instrumentations: buildServiceInstrumentations(),
  });
}

const exporterUrl = resolveTraceExporterUrl();

warnIfDeploymentEnvironmentMissing();

if (!exporterUrl) {
  console.log('Tracing disabled: OTEL_EXPORTER_OTLP_ENDPOINT not defined');
} else if (!isUsableEndpointUrl(exporterUrl)) {
  console.log(
    'Tracing disabled: invalid OpenTelemetry exporter endpoint (expected an http(s) URL)',
  );
} else {
  console.log('Initializing tracing with endpoint:', exporterUrl);
  try {
    sdk = createSdk(exporterUrl);
    sdk.start();
  } catch (error) {
    // Telemetry must never take the service down: a broken exporter config
    // disables tracing instead of failing startup.
    console.log(
      'Tracing disabled: failed to initialize OpenTelemetry SDK',
      error,
    );
    sdk = undefined;
  }
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
