import {
  Controller,
  Get,
  INestApplication,
  Module,
  Version,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureHttp } from '../http/configure-http';
import { V1_AND_LEGACY } from '../versioning/api-version';
import { createPublicDocument, setupSwagger } from './setup-swagger';

@Controller('probe')
class ProbeController {
  @Get()
  @Version(V1_AND_LEGACY)
  get() {
    return {};
  }

  @Get(':id')
  @Version(V1_AND_LEGACY)
  one() {
    return {};
  }
}

@Controller('plain')
class PlainController {
  @Get()
  get() {
    return {};
  }
}

/**
 * ISS-2496. A v1 route is served at /v1/<route> and at /<route>, so Nest's
 * explorer lists it twice with one operationId. The document keeps the
 * unversioned paths only: it stays as it was before URI versioning, so the
 * frontend SDK generated from it does not change.
 */
describe('setupSwagger (ISS-2496)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    @Module({ controllers: [ProbeController, PlainController] })
    class TestModule {}
    const moduleRef = await Test.createTestingModule({
      imports: [TestModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureHttp(app);
    setupSwagger(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists each v1 route once, at its unversioned path', () => {
    const document = createPublicDocument(app);
    expect(Object.keys(document.paths).sort()).toEqual([
      '/plain',
      '/probe',
      '/probe/{id}',
    ]);
  });

  it('keeps every operationId unique', () => {
    const document = createPublicDocument(app);
    const ids = Object.values(document.paths).flatMap((item) =>
      Object.values(item as Record<string, { operationId?: string }>).map(
        (op) => op.operationId,
      ),
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('ProbeController_get');
  });

  // /swagger is today's backend path. /v1/swagger is what the gateway
  // forwards for /norse-api/v1/swagger once the chart sets versionPrefix "".
  it.each(['/swagger/json', '/v1/swagger/json'])(
    '%s serves the same document',
    async (path) => {
      const res = await request(app.getHttpServer()).get(path);
      expect(res.status).toBe(200);
      expect(Object.keys(res.body.paths)).toContain('/probe');
      expect(Object.keys(res.body.paths)).not.toContain('/v1/probe');
    },
  );

  it.each(['/swagger', '/v1/swagger'])('%s serves the UI', async (path) => {
    const res = await request(app.getHttpServer()).get(path).redirects(1);
    expect(res.status).toBe(200);
    expect(res.text).toContain('swagger-ui');
  });
});
