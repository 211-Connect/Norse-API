import { writeFileSync } from 'fs';
import { join } from 'path';
import 'reflect-metadata';
import { Controller, Module, Provider, Type } from '@nestjs/common';
import { DECORATORS } from '@nestjs/swagger/dist/constants';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { apiVersioningOptions } from 'src/common/versioning/api-version';
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
@Controller(['v2/search', 'search'])
class DocumentedV2SearchController extends V2SearchController {}
Reflect.defineMetadata(
  DECORATORS.API_EXCLUDE_CONTROLLER,
  [false],
  DocumentedV2SearchController,
);

// Swagger reads metadata only. Empty stand-ins replace the services (the guards need only ConfigService),
// so no Redis, Elasticsearch, ML broker or secret is needed.
const stub = (provide: Type<unknown>): Provider => ({
  provide,
  useValue: {},
});

@Module({
  imports: [ConfigModule],
  controllers: [DocumentedV2SearchController],
  providers: [stub(V2SearchService), stub(UsageMetricsService)],
})
class V2SearchDocumentationModule {}

const INTEGER_PARAMETERS = new Set(['page', 'limit', 'distance', 'age']);

/**
 * Two annotations come from the shared v1 query DTO, which also feeds the main
 * Swagger document and the frontend SDK, so they cannot change there:
 * - `page`, `limit`, `distance` and `age` read as `number`, while the server
 *   validates integers (`@IsInt`).
 * - `taxonomy` puts `oneOf` beside `schema`, which OpenAPI does not allow.
 * This pass corrects both in the v2 document only.
 */
function refineQueryParameters(document: OpenAPIObject): OpenAPIObject {
  for (const pathItem of Object.values(document.paths)) {
    for (const operation of Object.values(pathItem) as {
      parameters?: Array<Record<string, any>>;
    }[]) {
      for (const parameter of operation.parameters ?? []) {
        if (parameter.in !== 'query') continue;
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
      .setDescription(
        'Draft contract of `/v2/search`, generated from the code. The main Swagger document leaves it out until the v2 ADR (ISS-2493) is accepted.',
      )
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
