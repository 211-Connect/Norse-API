import http from 'node:http';
import { AddressInfo, Socket } from 'node:net';
import { Client, errors } from '@elastic/elasticsearch';
import {
  ELASTIC_V2_ISOLATION_DEFAULT_ON,
  elasticsearchOptions,
  V2ElasticScopeMiddleware,
} from './v2-isolation';

const asV2 = <T>(run: () => Promise<T>): Promise<T> =>
  new Promise((resolve, reject) =>
    new V2ElasticScopeMiddleware().use({} as any, {} as any, () => {
      // One await first: the scope must survive async hops, as in a handler.
      void Promise.resolve().then(run).then(resolve, reject);
    }),
  );

describe('v2 Elasticsearch isolation', () => {
  let server: http.Server;
  let sockets: Set<Socket>;
  let hang: RegExp | undefined;
  let stallBody = false;
  const clients: Client[] = [];

  beforeEach(async () => {
    hang = undefined;
    stallBody = false;
    sockets = new Set();
    server = http.createServer((req, res) => {
      if (hang?.test(req.url)) return;
      res.setHeader('x-elastic-product', 'Elasticsearch');
      res.setHeader('content-type', 'application/json');
      if (stallBody) return void res.write('{');
      res.end('{"count":1}');
    });
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  });

  afterEach(async () => {
    sockets.forEach((s) => s.destroy());
    await Promise.all(clients.splice(0).map((c) => c.close()));
    await new Promise((r) => server.close(r));
  });

  const build = (env: string | undefined, limitMs?: number) => {
    const node = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const values = {
      ELASTIC_NODE: node,
      ELASTIC_API_KEY: 'k',
      ELASTIC_V2_ISOLATION_ENABLED: env,
    };
    const client = new Client(
      elasticsearchOptions(
        { get: (key: string) => values[key] } as any,
        limitMs,
      ),
    );
    clients.push(client);
    return client;
  };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it.each([undefined, '', 'false', '1'])(
    'switch %p: the client options are as before',
    (env) => {
      expect(ELASTIC_V2_ISOLATION_DEFAULT_ON).toBe(false);
      const values = {
        ELASTIC_NODE: 'http://es',
        ELASTIC_API_KEY: 'k',
        ELASTIC_V2_ISOLATION_ENABLED: env,
      };
      expect(
        elasticsearchOptions({ get: (key: string) => values[key] } as any),
      ).toEqual({ node: 'http://es', auth: { apiKey: 'k' } });
    },
  );

  it('a hung v2 call fails with a timeout and frees its socket', async () => {
    const client = build('true', 200);
    hang = /./;
    let hungSocket: Socket;
    server.once('request', (req) => (hungSocket = req.socket));
    await expect(
      asV2(() => client.count({ index: 'hybrid' })),
    ).rejects.toBeInstanceOf(errors.TimeoutError);
    await sleep(50);
    // undici may open a fresh idle socket; the hung one must be gone.
    expect(hungSocket.destroyed).toBe(true);
  });

  it('a v2 answer whose body stalls fails too', async () => {
    const client = build('true', 200);
    stallBody = true;
    await expect(
      asV2(() => client.count({ index: 'hybrid' })),
    ).rejects.toThrow();
  }, 20_000);

  it('a v2 namespaced call (alias check) has the limit too', async () => {
    const client = build('true', 200);
    hang = /./;
    await expect(
      asV2(() => client.indices.existsAlias({ name: 'a' })),
    ).rejects.toBeInstanceOf(errors.TimeoutError);
  });

  it('a v1 call has no limit, also next to a v2 call', async () => {
    const client = build('true', 100);
    hang = /./;
    let state = 'pending';
    client.count({ index: 'v1' }).then(
      () => (state = 'ok'),
      () => (state = 'error'),
    );
    await expect(asV2(() => client.count({ index: 'v2' }))).rejects.toThrow();
    await sleep(400);
    expect(state).toBe('pending');
  });

  it('v1 answers while more v2 calls hang than one pool has sockets', async () => {
    const client = build('true', 2000);
    hang = /hybrid/;
    const held = Promise.allSettled(
      Array.from({ length: 400 }, () =>
        asV2(() => client.count({ index: 'hybrid' })),
      ),
    );
    await sleep(300);
    const startedAt = Date.now();
    await expect(client.count({ index: 'v1' })).resolves.toEqual({ count: 1 });
    expect(Date.now() - startedAt).toBeLessThan(1000);
    const results = await held;
    expect(
      results.every(
        (r) =>
          r.status === 'rejected' && r.reason instanceof errors.TimeoutError,
      ),
    ).toBe(true);
  }, 15_000);

  it('a v2 call returns the same answer and sends the key', async () => {
    const client = build('true');
    let key: string | undefined;
    server.prependListener('request', (req) => {
      key = req.headers.authorization;
    });
    await expect(
      asV2(() => client.count({ index: 'hybrid' })),
    ).resolves.toEqual({ count: 1 });
    expect(key).toBe('ApiKey k');
  });
});
