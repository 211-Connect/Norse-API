export const createMetricsServiceMock = () => ({
  observeDownstream: jest.fn((_dep: string, _op: string, fn: () => unknown) =>
    fn(),
  ),
  recordHttpRequest: jest.fn(),
  recordCacheAccess: jest.fn(),
  getMetrics: jest.fn(async () => '# HELP mocked\n'),
  getContentType: jest.fn(() => 'text/plain; version=0.0.4; charset=utf-8'),
});
