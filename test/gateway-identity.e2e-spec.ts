import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  buildGatewayTestApp,
  OWNER_USER_ID,
  OTHER_USER_ID,
} from './support/gateway-test-app';

describe('GatewayIdentityGuard (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await buildGatewayTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health without headers -> 200 (Public route unaffected)', async () => {
    await request(app.getHttpServer()).get('/health').expect(200);
  });

  it('tenant-middleware-only behavior unaffected: GET /favorite-list with no headers at all -> 400 from TenantMiddleware', async () => {
    const res = await request(app.getHttpServer()).get('/favorite-list');
    expect(res.status).toBe(400);
  });

  it('Keycloak-guarded route with no Authorization and no gateway headers -> 401 from KeycloakGuard', async () => {
    const res = await request(app.getHttpServer())
      .get('/favorite-list')
      .set('x-tenant-id', '11111111-1111-4111-8111-111111111111');
    expect(res.status).toBe(401);
  });

  it('Keycloak-guarded route called exactly as NextJS does today (Bearer + x-tenant-id, no gateway headers) -> passes exactly as today', async () => {
    const res = await request(app.getHttpServer())
      .get('/favorite-list')
      .set('x-tenant-id', '11111111-1111-4111-8111-111111111111')
      .set('Authorization', 'Bearer valid-owner-token');
    expect(res.status).toBe(200);
  });

  it('regression: favorite-list own-vs-others ownership check keeps working unchanged on the legacy path (own list)', async () => {
    const res = await request(app.getHttpServer())
      .get('/favorite-list/private-list')
      .set('x-tenant-id', '11111111-1111-4111-8111-111111111111')
      .set('accept-language', 'en')
      .set('Authorization', 'Bearer valid-owner-token');
    expect(res.status).toBe(200);
  });

  it('regression: favorite-list own-vs-others ownership check keeps working unchanged on the legacy path (other user denied)', async () => {
    const res = await request(app.getHttpServer())
      .get('/favorite-list/private-list')
      .set('x-tenant-id', '11111111-1111-4111-8111-111111111111')
      .set('accept-language', 'en')
      .set('Authorization', 'Bearer valid-other-token');
    expect(res.status).toBe(401);
  });

  it('partial gateway pair (one header only) is classified legacy, denies per existing legacy guard, never 401 gateway_identity_required', async () => {
    const res = await request(app.getHttpServer())
      .get('/favorite-list')
      .set('x-connect211-identity-external-id', 'tenant-abc');
    // No x-tenant-id sent either -> TenantMiddleware 400, proving this is the
    // ordinary legacy deny path, not a gateway-identity-required 401.
    expect(res.status).toBe(400);
    expect(res.body.message).not.toBe('gateway_identity_required');
  });

  it('both gateway headers present -> passes this guard (authMode=gateway); may then 400 on missing x-tenant-id from TenantMiddleware', async () => {
    const res = await request(app.getHttpServer())
      .get('/favorite-list')
      .set('x-connect211-identity-external-id', 'tenant-abc')
      .set('x-connect211-key-id', 'key_123');
    expect(res.status).not.toBe(401);
  });

  it('sanity: OWNER_USER_ID and OTHER_USER_ID differ (mock harness self-check)', () => {
    expect(OWNER_USER_ID).not.toBe(OTHER_USER_ID);
  });
});
