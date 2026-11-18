import type { INestApplication } from '@nestjs/common';
import { OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { pathVersionOf } from '../versioning/api-version';
import { buildSwaggerConfig } from './swagger-config';

/**
 * Where the UI is served. `swagger` is today's backend path (the gateway
 * strips `/norse-api/v1`). `v1/swagger` is what the gateway forwards for
 * `/norse-api/v1/swagger` once the chart sets `versionPrefix: ""`, so the
 * public URL does not move.
 */
const SWAGGER_PATHS = ['swagger', 'v1/swagger'];

const CUSTOM_CSS = `
      .swagger-ui .parameters-col_name {
        width: 250px;
        max-width: 250px;
      }
      .swagger-ui .parameters-col_description {
        width: calc(100% - 250px);
      }
    `;

/**
 * ISS-2496. Each v1 route is served at `/v1/<route>` and at `/<route>`
 * (`V1_AND_LEGACY`), so the explorer lists it twice with one operationId. Keep
 * the unversioned paths only: the document, and the frontend SDK generated
 * from it, stay as they were before URI versioning.
 */
export function withoutV1Duplicates(document: OpenAPIObject): OpenAPIObject {
  for (const path of Object.keys(document.paths)) {
    if (pathVersionOf(path) === '1') delete document.paths[path];
  }
  return document;
}

export function createPublicDocument(app: INestApplication): OpenAPIObject {
  return withoutV1Duplicates(
    SwaggerModule.createDocument(app, buildSwaggerConfig()),
  );
}

export function setupSwagger(app: INestApplication): void {
  const document = createPublicDocument(app);
  for (const path of SWAGGER_PATHS) {
    SwaggerModule.setup(path, app, document, {
      jsonDocumentUrl: `${path}/json`,
      customCss: CUSTOM_CSS,
    });
  }
}
