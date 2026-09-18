import { DocumentBuilder } from '@nestjs/swagger';

export function buildSwaggerConfig() {
  return new DocumentBuilder()
    .setTitle('Norse API')
    .setDescription('Welcome to Norse')
    .setVersion('1.0')
    .addApiKey(
      {
        type: 'apiKey',
        name: 'x-internal-api-key',
        in: 'header',
        description: 'Internal API key for protected endpoints',
      },
      'x-internal-api-key',
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: 'x-analytics-api-key',
        in: 'header',
        description: 'Analytics API key identifying the tenant',
      },
      'x-analytics-api-key',
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: 'X-API-Key',
        in: 'header',
        description:
          'Tenant-scoped API key. Send this header when calling through the API gateway; ' +
          'the gateway validates the key and injects the gateway identity headers ' +
          '(X-Connect211-Identity-External-Id and X-Connect211-Key-Id) used by the backend.',
      },
      'X-API-Key',
    )
    .addBearerAuth({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description:
        'Standard authentication using a Keycloak JWT bearer token. ' +
        'Required on Keycloak-guarded routes.',
    })
    .build();
}
