import { INestApplication } from '@nestjs/common';
import { RELEASE_HEADER } from '../release/release-info';
import { apiVersioningOptions } from '../versioning/api-version';

/**
 * CORS and versioning, shared by main.ts and the e2e specs so the specs
 * exercise the configuration production runs rather than a copy of it.
 */
export function configureHttp(app: INestApplication) {
  app.enableCors({ exposedHeaders: [RELEASE_HEADER] });
  app.enableVersioning(apiVersioningOptions);
}
