import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

jest.mock('dotenv/config', () => ({}));

const PRIVATE_SEARCH_TEXT = 'PRIVATE-SEARCH-TEXT';
const PROBE = join(
  __dirname,
  '..',
  'test',
  'support',
  'nestjs-request-context-probe.ts',
);

interface ProbeSpan {
  name: string;
  attributes: Record<string, unknown>;
}

/**
 * `@opentelemetry/instrumentation-nestjs-core` writes `req.originalUrl` into
 * `url.full` on the `Controller.method` span (`nestjs.type=request_context`).
 * That attribute is built by the Nest instrumentation, so the
 * `instrumentation-http`/`-undici` request hooks never see it: without the
 * exporter backstop the query string leaves the process whenever traces go
 * straight to Tempo.
 *
 * The probe runs in a plain Node process: Jest's module loader bypasses
 * `require-in-the-middle`, so the Nest instrumentation cannot patch
 * `@nestjs/core` inside the Jest sandbox.
 */
describe('inbound Nest handler spans (instrumentation-nestjs-core)', () => {
  let spans: ProbeSpan[];

  beforeAll(() => {
    const output = execFileSync(
      process.execPath,
      ['-r', 'ts-node/register/transpile-only', PROBE],
      {
        cwd: join(__dirname, '..'),
        encoding: 'utf8',
        timeout: 120_000,
        env: {
          ...process.env,
          OTEL_EXPORTER_OTLP_ENDPOINT: '',
          OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: '',
        },
      },
    );
    const line = output
      .split('\n')
      .find((candidate) => candidate.startsWith('PROBE_SPANS='));
    if (!line) {
      throw new Error(`probe printed no spans; output was:\n${output}`);
    }
    spans = JSON.parse(line.slice('PROBE_SPANS='.length)) as ProbeSpan[];
  });

  it('keeps the query string out of every span attribute and name', () => {
    const nestHandlerSpan = spans.find(
      (span) => span.attributes['nestjs.type'] === 'request_context',
    );
    expect(nestHandlerSpan).toBeDefined();
    expect(nestHandlerSpan?.attributes['url.full']).toBe('/search');

    for (const span of spans) {
      expect(span.name).not.toContain('?');
      expect(span.name).not.toContain(PRIVATE_SEARCH_TEXT);
      for (const [key, value] of Object.entries(span.attributes)) {
        const rendered = String(value);
        expect(rendered).not.toContain('?');
        expect(rendered).not.toContain(PRIVATE_SEARCH_TEXT);
        expect(key).not.toBe('url.query');
      }
    }
  });
});
