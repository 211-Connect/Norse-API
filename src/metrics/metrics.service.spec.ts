import {
  BadGatewayException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { TraceFlags, trace, type SpanContext } from '@opentelemetry/api';
import { Counter, Histogram, Registry, register } from '@prometheus-io/client';
import { MetricsService } from './metrics.service';

const SAMPLED_TRACE_ID = '0af7651916cd43dd8448eb211c80319c';
const SPAN_ID = 'b7ad6b7169203331';

/** Makes this span context the one returned by `trace.getActiveSpan()`. */
const mockActiveSpanContext = (spanContext: SpanContext): void => {
  jest
    .spyOn(trace, 'getActiveSpan')
    .mockReturnValue(trace.wrapSpanContext(spanContext));
};

const spanContextWith = (traceFlags: TraceFlags): SpanContext => ({
  traceId: SAMPLED_TRACE_ID,
  spanId: SPAN_ID,
  traceFlags,
});

describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(() => {
    register.clear();
    service = new MetricsService();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const getMetric = (name: string): Counter<string> => {
    const metric = register.getSingleMetric(name);
    expect(metric).toBeDefined();
    return metric as Counter<string>;
  };

  it('records http request counter series with labels and value 1', async () => {
    service.recordHttpRequest(
      'GET',
      'ResourceController.getResourceById',
      'resource',
      '200',
      'tenant-1',
      0.1,
    );

    const metric = getMetric('norse_http_requests_total');
    const values = (await metric.get()).values;
    expect(values).toHaveLength(1);
    expect(values[0].value).toBe(1);
    expect(values[0].labels).toEqual({
      method: 'GET',
      handler: 'ResourceController.getResourceById',
      status: '200',
      tenant_id: 'tenant-1',
      domain: 'resource',
    });
  });

  const isCountSeries = (
    v: unknown,
  ): v is { metricName: string; value: number } =>
    typeof v === 'object' && v !== null && 'metricName' in v;

  it('observes the http duration histogram with a count series of 1', async () => {
    service.recordHttpRequest(
      'GET',
      'ResourceController.getResourceById',
      'resource',
      '200',
      'tenant-1',
      0.1,
    );

    const metric = getMetric('norse_http_request_duration_seconds');
    const values = (await metric.get()).values;
    const count = values.find(
      (v) => isCountSeries(v) && v.metricName.endsWith('_count'),
    );
    expect(count).toBeDefined();
    expect(count.value).toBe(1);
  });

  it('serves metrics as OpenMetrics', async () => {
    expect(service.getContentType()).toBe(Registry.OPENMETRICS_CONTENT_TYPE);
    expect(register.contentType).toBe(Registry.OPENMETRICS_CONTENT_TYPE);
    expect(await service.getMetrics()).toContain('# EOF');
  });

  it('attaches a trace_id exemplar to the http duration histogram for a sampled span', async () => {
    mockActiveSpanContext(spanContextWith(TraceFlags.SAMPLED));
    service.recordHttpRequest(
      'GET',
      'ResourceController.getResourceById',
      'resource',
      '200',
      'tenant-1',
      0.1,
    );

    const output = await service.getMetrics();
    expect(output).toMatch(
      /norse_http_request_duration_seconds_bucket\{[^\n]*\} 1 # \{trace_id="0af7651916cd43dd8448eb211c80319c"\}/,
    );
  });

  it('attaches no exemplar when the active span is unsampled', async () => {
    mockActiveSpanContext(spanContextWith(TraceFlags.NONE));
    service.recordHttpRequest(
      'GET',
      'ResourceController.getResourceById',
      'resource',
      '200',
      'tenant-1',
      0.1,
    );

    const output = await service.getMetrics();
    expect(output).toContain('norse_http_request_duration_seconds_count');
    expect(output).not.toContain('trace_id=');
  });

  it('attaches no exemplar when there is no active span', async () => {
    service.recordHttpRequest(
      'GET',
      'ResourceController.getResourceById',
      'resource',
      '200',
      'tenant-1',
      0.1,
    );

    const output = await service.getMetrics();
    expect(output).toContain('norse_http_request_duration_seconds_count');
    expect(output).not.toContain('trace_id=');
  });

  it('attaches a trace_id exemplar to the downstream duration histogram for a sampled span', async () => {
    mockActiveSpanContext(spanContextWith(TraceFlags.SAMPLED));
    await service.observeDownstream('ml_broker', 'predict', async () => 'ok');

    const output = await service.getMetrics();
    expect(output).toMatch(
      /norse_downstream_duration_seconds_bucket\{[^\n]*\} 1 # \{trace_id="0af7651916cd43dd8448eb211c80319c"\}/,
    );
  });

  it('records cache access counter series with labels and value 1', async () => {
    service.recordCacheAccess('request-redis', 'hit');

    const metric = getMetric('norse_cache_requests_total');
    const values = (await metric.get()).values;
    expect(values).toHaveLength(1);
    expect(values[0].value).toBe(1);
    expect(values[0].labels).toEqual({
      cache: 'request-redis',
      result: 'hit',
    });
  });

  it('observeDownstream returns the result and records outcome ok', async () => {
    const result = await service.observeDownstream(
      'ml_broker',
      'predict',
      async () => 'ok',
    );

    expect(result).toBe('ok');

    const metric = getMetric('norse_downstream_requests_total');
    const values = (await metric.get()).values;
    expect(values).toHaveLength(1);
    expect(values[0].value).toBe(1);
    expect(values[0].labels).toEqual({
      dependency: 'ml_broker',
      operation: 'predict',
      outcome: 'ok',
    });
  });

  it('observeDownstream rethrows the original error and records outcome error', async () => {
    const err = new BadGatewayException('upstream failed');

    await expect(
      service.observeDownstream('ml_broker', 'predict', async () => {
        throw err;
      }),
    ).rejects.toBe(err);

    const metric = getMetric('norse_downstream_requests_total');
    const values = (await metric.get()).values;
    expect(values).toHaveLength(1);
    expect(values[0].labels).toEqual({
      dependency: 'ml_broker',
      operation: 'predict',
      outcome: 'error',
    });
  });

  it('observes the downstream duration histogram with the same outcome labels', async () => {
    const metric = register.getSingleMetric(
      'norse_downstream_duration_seconds',
    ) as Histogram<string>;

    await service.observeDownstream('ml_broker', 'predict', async () => 'ok');

    await expect(
      service.observeDownstream('ml_broker', 'predict', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const counts = (await metric.get()).values.filter((v) =>
      v.metricName?.endsWith('_count'),
    );
    expect(counts).toHaveLength(2);
    for (const count of counts) {
      expect(count.labels).toMatchObject({
        dependency: 'ml_broker',
        operation: 'predict',
      });
      expect(count.value).toBe(1);
    }
    expect(counts.map((count) => count.labels.outcome).sort()).toEqual([
      'error',
      'ok',
    ]);
  });

  const expectOutcome = async (
    err: unknown,
    outcome: 'ok' | 'timeout' | 'error',
  ) => {
    await expect(
      service.observeDownstream('ml_broker', 'predict', async () => {
        throw err;
      }),
    ).rejects.toBe(err);

    const metric = getMetric('norse_downstream_requests_total');
    const values = (await metric.get()).values;
    expect(values).toHaveLength(1);
    expect(values[0].labels).toEqual({
      dependency: 'ml_broker',
      operation: 'predict',
      outcome,
    });
  };

  it('observeDownstream records outcome timeout for a TimeoutError-named error', async () => {
    await expectOutcome({ name: 'TimeoutError' }, 'timeout');
  });

  it('observeDownstream records outcome timeout for an AbortError-named error', async () => {
    await expectOutcome({ name: 'AbortError' }, 'timeout');
  });

  it('observeDownstream records outcome error for a 503 HttpException', async () => {
    await expectOutcome(new ServiceUnavailableException('too slow'), 'error');
  });

  it('observeDownstream classifies successful results via classifyResult and still returns them', async () => {
    const result = await service.observeDownstream(
      'ml_broker',
      'predict',
      async () => ({ ok: false }),
      (res) => (res.ok ? 'ok' : 'error'),
    );

    expect(result).toEqual({ ok: false });

    const metric = getMetric('norse_downstream_requests_total');
    const values = (await metric.get()).values;
    expect(values).toHaveLength(1);
    expect(values[0].labels).toEqual({
      dependency: 'ml_broker',
      operation: 'predict',
      outcome: 'error',
    });
  });
});
