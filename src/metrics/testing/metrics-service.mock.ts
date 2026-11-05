export const createMetricsServiceMock = () => ({
  observeDownstream: jest.fn((_dep: string, _op: string, fn: () => unknown) =>
    fn(),
  ),
  recordHttpRequest: jest.fn(),
  recordCacheAccess: jest.fn(),
  getMetrics: jest.fn(async () => '# HELP mocked\n'),
  getContentType: jest.fn(
    () => 'application/openmetrics-text; version=1.0.0; charset=utf-8',
  ),
});
