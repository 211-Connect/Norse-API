import { Response } from 'express';
import { MetricsController } from './metrics.controller';
import { createMetricsServiceMock } from './testing/metrics-service.mock';

describe('MetricsController', () => {
  let metricsMock: {
    getMetrics: jest.Mock;
    getContentType: jest.Mock;
  };
  let controller: MetricsController;

  const buildConfig = (values: {
    endpointEnabled?: boolean;
    token?: string;
  }) => ({
    get: jest.fn((key: string, defaultValue?: unknown) => {
      if (key === 'METRICS_ENDPOINT_ENABLED')
        return values.endpointEnabled ?? false;
      if (key === 'METRICS_TOKEN') return values.token ?? '';
      return defaultValue;
    }),
  });

  const buildRes = (authorization?: string) => {
    const res = {
      req: { headers: authorization ? { authorization } : {} },
      status: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    };
    return { res: res as unknown as Response, resMock: res };
  };

  const instantiate = (values: {
    endpointEnabled?: boolean;
    token?: string;
  }) => {
    metricsMock = createMetricsServiceMock();
    controller = new MetricsController(
      metricsMock as never,
      buildConfig(values) as never,
    );
  };

  it('responds 404 with an empty body when the endpoint is disabled', async () => {
    instantiate({ endpointEnabled: false });
    const { res, resMock } = buildRes();

    await controller.getMetrics(res);

    expect(resMock.status).toHaveBeenCalledWith(404);
    expect(resMock.send).toHaveBeenCalledWith();
    expect(metricsMock.getMetrics).not.toHaveBeenCalled();
  });

  it('responds 200 with the prometheus content type when enabled without a token', async () => {
    instantiate({ endpointEnabled: true });
    const { res, resMock } = buildRes();

    await controller.getMetrics(res);

    expect(resMock.status).toHaveBeenCalledWith(200);
    expect(resMock.set).toHaveBeenCalledWith({
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    expect(resMock.send).toHaveBeenCalledWith('# HELP mocked\n');
  });

  it('responds 401 when a token is configured and the Authorization header is missing', async () => {
    instantiate({ endpointEnabled: true, token: 'secret' });
    const { res, resMock } = buildRes(undefined);

    await controller.getMetrics(res);

    expect(resMock.status).toHaveBeenCalledWith(401);
    expect(metricsMock.getMetrics).not.toHaveBeenCalled();
  });

  it('responds 401 when the Authorization header is wrong', async () => {
    instantiate({ endpointEnabled: true, token: 'secret' });
    const { res, resMock } = buildRes('Bearer not-secret');

    await controller.getMetrics(res);

    expect(resMock.status).toHaveBeenCalledWith(401);
  });

  it('responds 401 when the Authorization header has a different length', async () => {
    instantiate({ endpointEnabled: true, token: 'secret' });
    const { res, resMock } = buildRes('Bearer shorter');

    await controller.getMetrics(res);

    expect(resMock.status).toHaveBeenCalledWith(401);
  });

  it('responds 200 when the Authorization header matches the token', async () => {
    instantiate({ endpointEnabled: true, token: 'secret' });
    const { res, resMock } = buildRes('Bearer secret');

    await controller.getMetrics(res);

    expect(resMock.status).toHaveBeenCalledWith(200);
    expect(resMock.send).toHaveBeenCalledWith('# HELP mocked\n');
  });

  it('responds 500 when getMetrics throws', async () => {
    instantiate({ endpointEnabled: true });
    metricsMock.getMetrics.mockRejectedValueOnce(new Error('render failed'));
    const { res, resMock } = buildRes();

    await controller.getMetrics(res);

    expect(resMock.status).toHaveBeenCalledWith(500);
  });
});
