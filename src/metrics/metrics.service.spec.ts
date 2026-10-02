import {
  BadGatewayException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Counter, Pushgateway, register } from 'prom-client';
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

  it('does not register push self-observability metrics when push is disabled', () => {
    register.clear();
    const disabledConfig = {
      get: jest.fn((key: string) =>
        key === 'PUSH_METRICS_ENABLED' ? false : undefined,
      ),
    };
    const disabled = new MetricsService(disabledConfig as never);

    expect(
      register.getSingleMetric('norse_metrics_push_success_timestamp_seconds'),
    ).toBeUndefined();
    expect(
      register.getSingleMetric('norse_metrics_push_failures_total'),
    ).toBeUndefined();
    // Scrape surface still exists.
    expect(typeof disabled.getContentType()).toBe('string');
  });

  it('does not register push metrics or warn when gateway URL is empty even if push is enabled', () => {
    register.clear();
    const warnSpy = jest.spyOn(Logger.prototype, 'warn');
    const config = {
      get: jest.fn((key: string) =>
        key === 'PUSH_METRICS_ENABLED'
          ? true
          : key === 'METRICS_ENDPOINT_ENABLED'
            ? true
            : undefined,
      ),
    };
    new MetricsService(config as never);

    expect(
      register.getSingleMetric('norse_metrics_push_success_timestamp_seconds'),
    ).toBeUndefined();
    expect(
      register.getSingleMetric('norse_metrics_push_failures_total'),
    ).toBeUndefined();
    expect(
      warnSpy.mock.calls.some(([msg]) =>
        String(msg).includes('both push and scrape'),
      ),
    ).toBe(false);
    warnSpy.mockRestore();
  });

  it('does not register push metrics or warn when push is disabled with a gateway URL', () => {
    register.clear();
    const warnSpy = jest.spyOn(Logger.prototype, 'warn');
    const config = {
      get: jest.fn((key: string) =>
        key === 'PUSH_GATEWAY_URL'
          ? 'http://gw:9091'
          : key === 'PUSH_METRICS_ENABLED'
            ? false
            : key === 'METRICS_ENDPOINT_ENABLED'
              ? true
              : undefined,
      ),
    };
    new MetricsService(config as never);

    expect(
      register.getSingleMetric('norse_metrics_push_success_timestamp_seconds'),
    ).toBeUndefined();
    expect(
      register.getSingleMetric('norse_metrics_push_failures_total'),
    ).toBeUndefined();
    expect(
      warnSpy.mock.calls.some(([msg]) =>
        String(msg).includes('both push and scrape'),
      ),
    ).toBe(false);
    warnSpy.mockRestore();
  });

  it('registers push metrics and warns about double counting when push and scrape are both active', async () => {
    register.clear();
    jest.useFakeTimers();
    const warnSpy = jest.spyOn(Logger.prototype, 'warn');
    const pushSpy = jest
      .spyOn(Pushgateway.prototype, 'push')
      .mockResolvedValue({});
    jest.spyOn(Pushgateway.prototype, 'delete').mockResolvedValue({});
    const config = {
      get: jest.fn((key: string) =>
        key === 'PUSH_GATEWAY_URL'
          ? 'http://gw:9091'
          : key === 'PUSH_METRICS_ENABLED'
            ? true
            : key === 'METRICS_ENDPOINT_ENABLED'
              ? true
              : key === 'PUSH_INTERVAL_MS'
                ? 15000
                : undefined,
      ),
    };
    const svc = new MetricsService(config as never);

    expect(
      register.getSingleMetric('norse_metrics_push_success_timestamp_seconds'),
    ).toBeDefined();
    expect(
      register.getSingleMetric('norse_metrics_push_failures_total'),
    ).toBeDefined();
    expect(
      warnSpy.mock.calls.some(([msg]) =>
        String(msg).includes('both push and scrape'),
      ),
    ).toBe(true);

    await svc.onModuleDestroy();
    expect(pushSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('registers push metrics without warning when scrape endpoint is disabled', () => {
    register.clear();
    const warnSpy = jest.spyOn(Logger.prototype, 'warn');
    jest.spyOn(Pushgateway.prototype, 'push').mockResolvedValue({});
    jest.spyOn(Pushgateway.prototype, 'delete').mockResolvedValue({});
    const config = {
      get: jest.fn((key: string) =>
        key === 'PUSH_GATEWAY_URL'
          ? 'http://gw:9091'
          : key === 'PUSH_METRICS_ENABLED'
            ? true
            : key === 'METRICS_ENDPOINT_ENABLED'
              ? false
              : key === 'PUSH_INTERVAL_MS'
                ? 15000
                : undefined,
      ),
    };
    const svc = new MetricsService(config as never);

    expect(
      register.getSingleMetric('norse_metrics_push_success_timestamp_seconds'),
    ).toBeDefined();
    expect(
      register.getSingleMetric('norse_metrics_push_failures_total'),
    ).toBeDefined();
    expect(
      warnSpy.mock.calls.some(([msg]) =>
        String(msg).includes('both push and scrape'),
      ),
    ).toBe(false);

    void svc.onModuleDestroy();
    warnSpy.mockRestore();
  });

  it('onModuleDestroy resolves when no pushgateway is configured', async () => {
    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
  });

  it('onModuleDestroy waits for an in-flight periodic push before deleting the group', async () => {
    jest.useFakeTimers();
    const gatewayConfigMock = {
      get: jest.fn((key: string) => {
        if (key === 'PUSH_GATEWAY_URL') return 'http://gateway:9091';
        if (key === 'PUSH_METRICS_ENABLED') return true;
        if (key === 'PUSH_INTERVAL_MS') return 15000;
        return undefined;
      }),
    };

    const callOrder: string[] = [];
    register.clear();
    let resolveFirstPush: (value: {
      resp?: unknown;
      body?: unknown;
    }) => void = () => {};
    const firstPush = new Promise<{ resp?: unknown; body?: unknown }>(
      (resolve) => {
        resolveFirstPush = resolve;
      },
    );
    let pushCount = 0;
    jest.spyOn(Pushgateway.prototype, 'push').mockImplementation(() => {
      pushCount += 1;
      callOrder.push('push');
      return pushCount === 1 ? firstPush : Promise.resolve({});
    });
    const deleteSpy = jest
      .spyOn(Pushgateway.prototype, 'delete')
      .mockImplementation(() => {
        callOrder.push('delete');
        return Promise.resolve({});
      });

    const gatewayService = new MetricsService(gatewayConfigMock as never);

    jest.advanceTimersByTime(15000);
    const destroy = gatewayService.onModuleDestroy();

    expect(deleteSpy).not.toHaveBeenCalled();

    resolveFirstPush({});
    await destroy;

    expect(callOrder).toEqual(['push', 'push', 'delete']);
  });

  it('configures the pushgateway with a 5s request timeout', async () => {
    jest.useFakeTimers();
    const gatewayConfigMock = {
      get: jest.fn((key: string) => {
        if (key === 'PUSH_GATEWAY_URL') return 'http://gateway:9091';
        if (key === 'PUSH_METRICS_ENABLED') return true;
        if (key === 'PUSH_INTERVAL_MS') return 15000;
        return undefined;
      }),
    };
    jest.spyOn(Pushgateway.prototype, 'push').mockResolvedValue({});
    jest.spyOn(Pushgateway.prototype, 'delete').mockResolvedValue({});

    register.clear();
    const svc = new MetricsService(gatewayConfigMock as never);

    const gateway = (
      svc as unknown as { gateway: { requestOptions: { timeout?: number } } }
    ).gateway;
    expect(gateway.requestOptions.timeout).toBe(5000);

    await svc.onModuleDestroy();
  });
});
