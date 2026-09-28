describe('tracing', () => {
  const originalEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  afterEach(() => {
    if (originalEndpoint === undefined) {
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    } else {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = originalEndpoint;
    }
    jest.restoreAllMocks();
  });

  it('registers no SIGTERM handler and shutdownTracing resolves when tracing is disabled', async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const before = process.listenerCount('SIGTERM');

    let mod: typeof import('./tracing');
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('./tracing');
    });

    expect(process.listenerCount('SIGTERM')).toBe(before);
    await expect(mod!.shutdownTracing()).resolves.toBeUndefined();
  });

  it('registers no SIGTERM handler when tracing is enabled; shutdownTracing is idempotent', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://127.0.0.1:4317';
    const before = process.listenerCount('SIGTERM');

    jest.doMock('@opentelemetry/sdk-node', () => ({
      NodeSDK: class {
        start = jest.fn();
        shutdown = jest.fn().mockResolvedValue(undefined);
      },
    }));

    let mod: typeof import('./tracing');
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('./tracing');
    });

    expect(process.listenerCount('SIGTERM')).toBe(before);

    await expect(mod!.shutdownTracing()).resolves.toBeUndefined();
    await expect(mod!.shutdownTracing()).resolves.toBeUndefined();
  });
});
