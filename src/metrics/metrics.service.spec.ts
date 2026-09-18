import {
  BadGatewayException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Counter, register } from 'prom-client';
import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  let service: MetricsService;

  const configServiceMock = {
    get: jest.fn((key: string) =>
      key === 'PUSH_GATEWAY_URL' ? '' : undefined,
    ),
  };

  beforeEach(() => {
    register.clear();
    service = new MetricsService(configServiceMock as never);
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

  it('onModuleDestroy resolves when no pushgateway is configured', async () => {
    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
  });
});
