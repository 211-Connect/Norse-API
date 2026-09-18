import { INestApplication } from '@nestjs/common';
import * as http from 'http';
import { AddressInfo } from 'net';
import request from 'supertest';
import { buildGatewayTestApp } from './support/gateway-test-app';

type StubHandler = (req: http.IncomingMessage) => {
  status: number;
  body?: unknown;
};

function startStubServer(handler: StubHandler): Promise<{
  server: http.Server;
  baseUrl: string;
  requestCount: () => number;
}> {
  let count = 0;
  const server = http.createServer((req, res) => {
    count += 1;
    const { status, body } = handler(req);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(body === undefined ? undefined : JSON.stringify(body));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${port}`,
        requestCount: () => count,
      });
    });
  });
}

const GATEWAY_HEADERS = {
  'x-connect211-identity-external-id': 'tenant-abc',
  'x-connect211-key-id': 'key_123',
  // FavoriteListController also carries TenantMiddleware, which runs before
  // any guard - a valid x-tenant-id is required to reach this guard at all.
  'x-tenant-id': '11111111-1111-4111-8111-111111111111',
};

describe('GatewayPermissionsGuard (e2e)', () => {
  describe('with stubbed 200 response', () => {
    let app: INestApplication;
    let stub: Awaited<ReturnType<typeof startStubServer>>;

    beforeAll(async () => {
      stub = await startStubServer(() => ({
        status: 200,
        body: { keyId: 'key_123', permissions: ['norse-api.invoke'] },
      }));
      app = await buildGatewayTestApp({
        includePermissionsGuard: true,
        permissionsSideChannelBaseUrl: stub.baseUrl,
      });
    });

    afterAll(async () => {
      await app.close();
      stub.server.close();
    });

    it('gateway headers + stubbed 200 -> passes this layer (not 401/503)', async () => {
      const res = await request(app.getHttpServer())
        .get('/probe')
        .set(GATEWAY_HEADERS);
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(503);
    });

    it('GET /health without headers -> 200 and no side-channel request received (Public skip)', async () => {
      const before = stub.requestCount();
      await request(app.getHttpServer()).get('/health').expect(200);
      expect(stub.requestCount()).toBe(before);
    });

    it('legacy path (Authorization + x-tenant-id, no gateway headers) makes no side-channel request', async () => {
      const before = stub.requestCount();
      await request(app.getHttpServer())
        .get('/favorite-list')
        .set('x-tenant-id', '11111111-1111-4111-8111-111111111111')
        .set('Authorization', 'Bearer valid-owner-token')
        .expect(200);
      expect(stub.requestCount()).toBe(before);
    });
  });

  describe('with stubbed 404 response', () => {
    let app: INestApplication;
    let stub: Awaited<ReturnType<typeof startStubServer>>;

    beforeAll(async () => {
      stub = await startStubServer(() => ({
        status: 404,
        body: { error: 'key_not_found' },
      }));
      app = await buildGatewayTestApp({
        includePermissionsGuard: true,
        permissionsSideChannelBaseUrl: stub.baseUrl,
      });
    });

    afterAll(async () => {
      await app.close();
      stub.server.close();
    });

    it('gateway headers + stubbed 404 -> 401 gateway_key_not_found', async () => {
      const res = await request(app.getHttpServer())
        .get('/probe')
        .set(GATEWAY_HEADERS);
      expect(res.status).toBe(401);
      expect(res.body.message).toBe('gateway_key_not_found');
    });
  });

  describe('with stubbed 503 / unreachable', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await buildGatewayTestApp({
        includePermissionsGuard: true,
        permissionsSideChannelBaseUrl: 'http://127.0.0.1:1',
      });
    });

    afterAll(async () => {
      await app.close();
    });

    it('unreachable side-channel -> 503 permissions_unavailable', async () => {
      const res = await request(app.getHttpServer())
        .get('/probe')
        .set(GATEWAY_HEADERS);
      expect(res.status).toBe(503);
      expect(res.body.message).toBe('permissions_unavailable');
    });
  });
});
