import { Controller, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { RegionController } from 'src/region/internal/region.controller';
import { RegionService } from 'src/region/internal/region.service';
import { apiVersioningOptions } from 'src/common/versioning/api-version';

// The documentation controller is never mounted by AppModule. It inherits the
// runtime routes and DTO metadata without the runtime controller's exclusion.
@Controller('internal/regions')
class DocumentedRegionController extends RegionController {}

@Module({
  imports: [ConfigModule],
  controllers: [DocumentedRegionController],
  providers: [
    RegionService,
    {
      provide: ElasticsearchService,
      // Swagger scans metadata only; the client does not connect to this node.
      useFactory: () =>
        new ElasticsearchService({ node: 'http://127.0.0.1:9200' }),
    },
  ],
})
class InternalRegionsDocumentationModule {}

/** Generate a standalone internal contract without external services or HTTP exposure. */
export async function createInternalRegionsOpenApi(): Promise<OpenAPIObject> {
  const app = await NestFactory.create(InternalRegionsDocumentationModule, {
    logger: false,
  });
  try {
    app.enableVersioning(apiVersioningOptions);
    const config = new DocumentBuilder()
      .setTitle('Norse API: internal Regions')
      .setDescription(
        'Internal, global Region catalog endpoints. Requires the internal API key.',
      )
      .setVersion('1.0.0')
      .addApiKey(
        { type: 'apiKey', name: 'x-internal-api-key', in: 'header' },
        'x-internal-api-key',
      )
      .build();
    return SwaggerModule.createDocument(app, config);
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  createInternalRegionsOpenApi()
    .then((document) =>
      process.stdout.write(`${JSON.stringify(document, null, 2)}\n`),
    )
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
