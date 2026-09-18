export const createMetricsServiceMock = () => ({
  observeDownstream: jest.fn((_dep: string, _op: string, fn: () => unknown) =>
    fn(),
  ),
  recordHttpRequest: jest.fn(),
  recordCacheAccess: jest.fn(),
});
