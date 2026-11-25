import { writeFileSync } from 'fs';
import { join } from 'path';
import 'reflect-metadata';
import { Controller, Module, Provider, Type } from '@nestjs/common';
import { DECORATORS } from '@nestjs/swagger/dist/constants';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { apiVersioningOptions } from 'src/common/versioning/api-version';
import { TenantConfigService } from 'src/cms-config/tenant-config.service';
import { UsageMetricsService } from 'src/metrics/usage-metrics.service';
import { V2SearchController } from 'src/v2/search/v2-search.controller';
import { V2SearchService } from 'src/v2/search/v2-search.service';

// The runtime controller carries @ApiExcludeController() so the main Swagger
// document (and the frontend SDK built from it) stays free of the draft v2
// shapes. This documentation controller is never mounted by AppModule. It
// inherits the routes and DTO metadata and switches the exclusion off for this
// standalone document only.
// `@ApiExcludeController(false)` cannot do this: the decorator appends to the
// inherited list and Swagger reads the first entry, which stays `true`. The
// subclass therefore sets its own metadata entry directly.
@Controller('search')
class DocumentedV2SearchController extends V2SearchController {}
Reflect.defineMetadata(
  DECORATORS.API_EXCLUDE_CONTROLLER,
  [false],
  DocumentedV2SearchController,
);

// Swagger reads metadata only. Empty stand-ins replace the services (the guards need ConfigService and an empty tenant-config stand-in),
// so no Redis, Elasticsearch, ML broker or secret is needed.
const stub = (provide: Type<unknown>): Provider => ({
  provide,
  useValue: {},
});

@Module({
  imports: [ConfigModule],
  controllers: [DocumentedV2SearchController],
  providers: [
    stub(V2SearchService),
    stub(UsageMetricsService),
    stub(TenantConfigService),
  ],
})
class V2SearchDocumentationModule {}

const INTEGER_PARAMETERS = new Set(['page', 'limit', 'distance', 'age']);

// The shared v1 DTO describes `relevance_cutoff` for v1 (hybrid only, a fixed
// fraction). On v2 the cut uses the dynamic ladder only (ADR 0039 Decision 77).
const V2_PARAMETER_DESCRIPTIONS: Record<string, string> = {
  relevance_cutoff:
    '`on` trims low-relevance results; `off` (default) returns the full matched set. The cut uses the dynamic ladder only: 0.2 of the top score, tightened stepwise up to 0.5 when more than 1,000 results would survive, and never below the top-20 scores. There is no `relevance_cutoff_fraction` parameter (ADR 0039 Decision 77). The cut reads scores after the need boost (Decision 58). When a cutoff applies, `hits.total` reports the kept count and `relevance_cutoff.matched_before_cutoff` keeps the original.',
};

const V2_DESCRIPTION = [
  'Draft contract of `/v2/search`, generated from the code. The main Swagger document leaves it out until the v2 ADR (ISS-2493) is accepted.',
  '',
  'Confirmed by David, 2026-11-18 (ADR 0039 Decisions 77-81):',
  '- `relevance_cutoff` uses the dynamic ladder only; there is no `relevance_cutoff_fraction` parameter.',
  '- Classification always runs; there is no `classify` parameter. `clarify` (`auto` or `never`) stays.',
  '- The need boost is on by default.',
  '- For v2 tenants, Norse-API writes tenant scorecard overrides to `sune_scorecard`.',
  "- Payload has a tenant boolean `enableV2Api` (pushed to Redis) and a search engine option `v2`, refused unless `enableV2Api` is on. Both choose the search Norse's own pages use.",
  '',
  'Changed 2026-11-25 (replaces the per-tenant gate on `/v2/search` of Decisions 81 and 91): `enableV2Api` does not gate the API. One deployment switch, `V2_SEARCH_ENABLED`, turns the route on for every tenant a key may read.',
].join('\n');

/**
 * Three annotations come from the shared v1 query DTO, which also feeds the main
 * Swagger document and the frontend SDK, so they cannot change there:
 * - `page`, `limit`, `distance` and `age` read as `number`, while the server
 *   validates integers (`@IsInt`).
 * - `taxonomy` puts `oneOf` beside `schema`, which OpenAPI does not allow.
 * - `relevance_cutoff` carries the v1 text; v2 has its own (V2_PARAMETER_DESCRIPTIONS).
 * This pass corrects them in the v2 document only.
 */
function refineQueryParameters(document: OpenAPIObject): OpenAPIObject {
  for (const pathItem of Object.values(document.paths)) {
    for (const operation of Object.values(pathItem) as {
      parameters?: Array<Record<string, any>>;
    }[]) {
      for (const parameter of operation.parameters ?? []) {
        if (parameter.in !== 'query') continue;
        if (V2_PARAMETER_DESCRIPTIONS[parameter.name]) {
          parameter.description = V2_PARAMETER_DESCRIPTIONS[parameter.name];
        }
        if (INTEGER_PARAMETERS.has(parameter.name)) {
          parameter.schema = { ...parameter.schema, type: 'integer' };
        }
        if (parameter.oneOf) {
          parameter.schema = {
            oneOf: parameter.oneOf,
            default: parameter.schema?.default,
          };
          delete parameter.oneOf;
        }
      }
    }
  }
  return document;
}

/** Generate a standalone v2 search contract without external services or HTTP exposure. */
export async function createV2SearchOpenApi(): Promise<OpenAPIObject> {
  const app = await NestFactory.create(V2SearchDocumentationModule, {
    logger: false,
  });
  try {
    app.enableVersioning(apiVersioningOptions);
    const config = new DocumentBuilder()
      .setTitle('Norse API: v2 search (draft)')
      .setDescription(V2_DESCRIPTION)
      .setVersion('2.0.0-draft')
      .build();
    return refineQueryParameters(SwaggerModule.createDocument(app, config));
  } finally {
    await app.close();
  }
}

export const V2_SEARCH_OPENAPI_PATH = join(
  __dirname,
  '../../../docs/openapi/v2-search.openapi.json',
);

export function serializeOpenApi(document: OpenAPIObject): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

if (require.main === module) {
  createV2SearchOpenApi()
    .then((document) =>
      writeFileSync(V2_SEARCH_OPENAPI_PATH, serializeOpenApi(document)),
    )
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
