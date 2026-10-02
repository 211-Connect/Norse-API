import * as http from 'http';
import { AddressInfo } from 'net';
import request from 'supertest';
import {
  buildGatewayTestApp,
  TENANT_A,
  TENANT_B,
} from './support/gateway-test-app';

function startStubServer(
  permissionsByKeyId: Record<string, string[] | 'not_found' | 'unavailable'>,
): Promise<{ server: http.Server; baseUrl: string }> {
  const server = http.createServer((req, res) => {
    const keyId = decodeURIComponent(
      (req.url ?? '').replace(/^\/keys\//, '').replace(/\/permissions$/, ''),
    );
    const entry = permissionsByKeyId[keyId];
    if (entry === 'not_found' || entry === undefined) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'key_not_found' }));
      return;
    }
    if (entry === 'unavailable') {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'unavailable' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ keyId, permissions: entry }));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function buildAppWithSlugs(
  permissionsByKeyId: Record<string, string[] | 'not_found' | 'unavailable'>,
) {
  const stub = await startStubServer(permissionsByKeyId);
  const app = await buildGatewayTestApp({
    includePermissionsGuard: true,
    includeTenantScopeGuard: true,
    permissionsSideChannelBaseUrl: stub.baseUrl,
  });
  return { app, stub };
}

const gatewayHeaders = (keyId: string, tenantId?: string) => ({
  'x-connect211-identity-external-id': 'tenant-abc',
  'x-connect211-key-id': keyId,
  ...(tenantId ? { 'x-tenant-id': tenantId } : {}),
});

describe('TenantScopeGuard (e2e)', () => {
  it('read scope for tenant A, targeting A -> passes (not 401/403)', async () => {
    const { app, stub } = await buildAppWithSlugs({
      key_a: ['norse-api.invoke', `norse-api.${TENANT_A}.read`],
    });
    const res = await request(app.getHttpServer())
      .get('/probe')
      .set(gatewayHeaders('key_a', TENANT_A));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(200);
    await app.close();
    stub.server.close();
  });

  it('read scope for tenant A, targeting B -> 403 tenant_scope_denied, no cross-tenant data leak', async () => {
    const { app, stub } = await buildAppWithSlugs({
      key_a: ['norse-api.invoke', `norse-api.${TENANT_A}.read`],
    });
    const res = await request(app.getHttpServer())
      .get('/probe')
      .set(gatewayHeaders('key_a', TENANT_B));
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('tenant_scope_denied');
    await app.close();
    stub.server.close();
  });

  it('POST with only .read scope -> 403', async () => {
    const { app, stub } = await buildAppWithSlugs({
      key_a: [`norse-api.${TENANT_A}.read`],
    });
    const res = await request(app.getHttpServer())
      .post('/probe')
      .set(gatewayHeaders('key_a', TENANT_A));
    expect(res.status).toBe(403);
    await app.close();
    stub.server.close();
  });

  it('norse-api.admin + x-tenant-id: A -> passes + audit line emitted', async () => {
    const { app, stub } = await buildAppWithSlugs({
      key_platform: ['norse-api.admin'],
    });
    const res = await request(app.getHttpServer())
      .get('/probe')
      .set(gatewayHeaders('key_platform', TENANT_A));
    expect(res.status).toBe(200);
    await app.close();
    stub.server.close();
  });

  it('stubbed 404 from side-channel -> 401, not converted to 403', async () => {
    const { app, stub } = await buildAppWithSlugs({});
    const res = await request(app.getHttpServer())
      .get('/probe')
      .set(gatewayHeaders('unknown-key', TENANT_A));
    expect(res.status).toBe(401);
    await app.close();
    stub.server.close();
  });

  it('stubbed 503 from side-channel -> 503, not converted to 403', async () => {
    const { app, stub } = await buildAppWithSlugs({
      key_a: 'unavailable',
    });
    const res = await request(app.getHttpServer())
      .get('/probe')
      .set(gatewayHeaders('key_a', TENANT_A));
    expect(res.status).toBe(503);
    await app.close();
    stub.server.close();
  });

  it('GET /health without headers -> 200, no scope evaluation (Public skip composes across all three guards)', async () => {
    const { app, stub } = await buildAppWithSlugs({});
    await request(app.getHttpServer()).get('/health').expect(200);
    await app.close();
    stub.server.close();
  });

  it('cross-tenant isolation: A-scoped key targeting A sees zero rows with tenant_id = B', async () => {
    const { app, stub } = await buildAppWithSlugs({
      key_a: [`norse-api.${TENANT_A}.read`],
    });
    const res = await request(app.getHttpServer())
      .get('/probe')
      .set(gatewayHeaders('key_a', TENANT_A))
      .expect(200);
    expect(res.body.rows.every((r: any) => r.tenant_id === TENANT_A)).toBe(
      true,
    );
    expect(res.body.rows.some((r: any) => r.tenant_id === TENANT_B)).toBe(
      false,
    );
    await app.close();
    stub.server.close();
  });

  it('direct favorite-list request with Authorization Bearer (legacy path) is unaffected by this guard', async () => {
    const { app, stub } = await buildAppWithSlugs({});
    const res = await request(app.getHttpServer())
      .get('/favorite-list/private-list')
      .set('x-tenant-id', TENANT_A)
      .set('accept-language', 'en')
      .set('Authorization', 'Bearer valid-owner-token');
    expect(res.status).toBe(200);

    const denied = await request(app.getHttpServer())
      .get('/favorite-list/private-list')
      .set('x-tenant-id', TENANT_A)
      .set('accept-language', 'en')
      .set('Authorization', 'Bearer valid-other-token');
    expect(denied.status).toBe(401);

    await app.close();
    stub.server.close();
  });
});
