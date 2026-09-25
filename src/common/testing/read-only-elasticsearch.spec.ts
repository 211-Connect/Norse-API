import {
  BaseConnection,
  Client,
  ConnectionRequestParams,
} from '@elastic/elasticsearch';
import {
  ReadOnlyViolationError,
  RequestBudgetExceededError,
  createReadOnlyClient,
  isReadOnlyRequest,
  readOnlyConnection,
} from './read-only-elasticsearch';

/** Records what would have gone on the wire and answers like a cluster. */
const wire: { method: string; path: string }[] = [];

class RecordingConnection extends BaseConnection {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async request(params: ConnectionRequestParams): Promise<any> {
    wire.push({ method: params.method, path: params.path });
    const body = params.path.endsWith('_search')
      ? { hits: { total: { value: 0, relation: 'eq' }, hits: [] } }
      : params.path.endsWith('_count')
        ? { count: 0 }
        : {};
    return {
      statusCode: 200,
      headers: {
        'content-type': 'application/json',
        'x-elastic-product': 'Elasticsearch',
      },
      body: JSON.stringify(body),
    };
  }
}

describe('read-only Elasticsearch client', () => {
  let client: Client;

  beforeEach(() => {
    wire.length = 0;
    client = createReadOnlyClient({
      node: 'http://127.0.0.1:9',
      Connection: RecordingConnection,
      maxRetries: 0,
    }).client;
  });

  const writes: [string, (c: Client) => Promise<unknown>][] = [
    ['index', (c) => c.index({ index: 'services', document: { a: 1 } })],
    ['create', (c) => c.create({ index: 'services', id: '1', document: {} })],
    ['update', (c) => c.update({ index: 'services', id: '1', doc: {} })],
    ['delete', (c) => c.delete({ index: 'services', id: '1' })],
    ['bulk', (c) => c.bulk({ operations: [{ index: { _index: 's' } }, {}] })],
    [
      'deleteByQuery',
      (c) => c.deleteByQuery({ index: 'services', query: { match_all: {} } }),
    ],
    [
      'updateByQuery',
      (c) => c.updateByQuery({ index: 'services', query: { match_all: {} } }),
    ],
    [
      'reindex',
      (c) => c.reindex({ source: { index: 'a' }, dest: { index: 'b' } }),
    ],
    ['indices.create', (c) => c.indices.create({ index: 'services_x' })],
    ['indices.delete', (c) => c.indices.delete({ index: 'services' })],
    [
      'indices.putSettings',
      (c) =>
        c.indices.putSettings({
          index: 'services',
          settings: { number_of_replicas: 0 },
        }),
    ],
    [
      'indices.putMapping',
      (c) => c.indices.putMapping({ index: 'services', properties: {} }),
    ],
    [
      'indices.updateAliases',
      (c) =>
        c.indices.updateAliases({
          actions: [{ add: { index: 'regions_v1', alias: 'regions' } }],
        }),
    ],
    [
      'ingest.putPipeline',
      (c) => c.ingest.putPipeline({ id: 'p', processors: [] }),
    ],
    [
      'putScript',
      (c) =>
        c.putScript({ id: 's', script: { lang: 'painless', source: '1' } }),
    ],
    [
      'openPointInTime',
      (c) => c.openPointInTime({ index: 'services', keep_alive: '1m' }),
    ],
    ['scroll', (c) => c.scroll({ scroll_id: 'x', scroll: '1m' })],
  ];

  it.each(writes)('refuses %s before anything is sent', async (_name, call) => {
    await expect(call(client)).rejects.toBeInstanceOf(ReadOnlyViolationError);
    expect(wire).toEqual([]);
  });

  it('lets reads through', async () => {
    await client.search({ index: 'services', query: { match_all: {} } });
    await client.count({ index: 'services', query: { match_all: {} } });
    await client.mget({ index: 'regions', ids: ['state:MO'], _source: false });
    await client.indices.getMapping({ index: 'services' });
    await client.cat.indices({ index: 'services' });
    await client
      .get({ index: 'regions', id: 'state:MO' })
      .catch(() => undefined);
    expect(wire.map((r) => `${r.method} ${r.path}`)).toEqual([
      'POST /services/_search',
      'POST /services/_count',
      'POST /regions/_mget',
      'GET /services/_mapping',
      'GET /_cat/indices/services',
      'GET /regions/_doc/state%3AMO',
    ]);
  });

  it('guards the connection too, so a transport that skipped its check still cannot write', () => {
    const Guarded = readOnlyConnection(RecordingConnection);
    const connection = new Guarded({ url: new URL('http://127.0.0.1:9') });
    expect(() =>
      connection.request({ method: 'POST', path: '/_bulk' }, {
        requestId: 1,
        context: null,
        name: 'x',
      } as never),
    ).toThrow(ReadOnlyViolationError);
    expect(wire).toEqual([]);
  });

  it('stops at the request budget', async () => {
    const { client: capped, meter } = createReadOnlyClient({
      node: 'http://127.0.0.1:9',
      Connection: RecordingConnection,
      maxRetries: 0,
      budget: 2,
    });
    await capped.count({ index: 'services' });
    await capped.count({ index: 'services' });
    await expect(capped.count({ index: 'services' })).rejects.toBeInstanceOf(
      RequestBudgetExceededError,
    );
    expect(meter.sent).toBe(2);
    expect(wire).toHaveLength(2);
  });

  it.each([
    ['POST', '/services/_search', true],
    ['POST', '/_search', true],
    ['POST', '/services/_count?q=x', true],
    ['POST', '/regions/_mget', true],
    ['GET', '/_cat/indices', true],
    ['POST', '/_search/scroll', false],
    ['POST', '/_search/template', false],
    ['POST', '/services/_async_search', false],
    ['POST', '/services/_msearch', false],
    ['POST', '/services/_doc', false],
    ['PUT', '/services/_doc/1', false],
    ['DELETE', '/services', false],
    ['POST', '/_aliases', false],
    ['POST', '/services/_pit', false],
  ])('%s %s allowed: %s', (method, path, allowed) => {
    expect(isReadOnlyRequest(method, path)).toBe(allowed);
  });
});
