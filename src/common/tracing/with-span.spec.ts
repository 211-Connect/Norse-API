import { SpanStatusCode } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace';
import { withSpan, withSpanSync } from './with-span';

describe('withSpan', () => {
  const exporter = new InMemorySpanExporter();
  const processor = new SimpleSpanProcessor({ exporter });
  const finished = async () => {
    await processor.forceFlush();
    return exporter.getFinishedSpans();
  };
  let sdk: NodeSDK;

  beforeAll(() => {
    sdk = new NodeSDK({
      metricReaders: [],
      logRecordProcessors: [],
      spanProcessors: [processor],
      instrumentations: [],
    });
    sdk.start();
  });

  beforeEach(() => exporter.reset());

  afterAll(() => sdk.shutdown());

  it('names the span, returns the result and nests child spans', async () => {
    const result = await withSpan(
      'parent',
      async () => withSpan('child', async () => 7),
      { 'test.attr': 1 },
    );

    expect(result).toBe(7);
    const [child, parent] = await finished();
    expect(child.name).toBe('child');
    expect(parent.name).toBe('parent');
    expect(parent.attributes['test.attr']).toBe(1);
    expect(child.parentSpanContext?.spanId).toBe(parent.spanContext().spanId);
  });

  it('marks a failed span with the error name only and rethrows', async () => {
    const error = new TypeError('search text must not leak');

    await expect(
      withSpan('failing', async () => {
        throw error;
      }),
    ).rejects.toBe(error);

    const [span] = await finished();
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.attributes['error.type']).toBe('TypeError');
    expect(JSON.stringify(span.attributes)).not.toContain('search text');
    expect(span.events).toHaveLength(0);
  });

  it('wraps a synchronous step', async () => {
    expect(withSpanSync('sync', () => 'ok')).toBe('ok');
    expect(() =>
      withSpanSync('sync-fail', () => {
        throw new Error('x');
      }),
    ).toThrow('x');

    const [ok, failed] = await finished();
    expect(ok.name).toBe('sync');
    expect(failed.status.code).toBe(SpanStatusCode.ERROR);
  });
});
