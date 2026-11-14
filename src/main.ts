import './tracing';

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { HttpExceptionFilter } from './common/filters/global-exception.filter';
import { buildSwaggerConfig } from './common/swagger/swagger-config';
import { configureHttp } from './common/http/configure-http';
import { useInternalServicesBodyLimit } from './service/internal/internal-services-body';
import { usePathVersion } from './common/versioning/path-version';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  const config = app.get(ConfigService);

  app.useLogger(app.get(Logger));

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      // `whitelist` and `forbidNonWhitelisted` should be set to `true` when zod is replaced by class-validator and all DTOs are decorated with validation decorators
      whitelist: false,
      forbidNonWhitelisted: false,
    }),
  );

  // ISS-2496: first, so every later layer sees the path without `/v<N>`.
  usePathVersion(app);
  useInternalServicesBodyLimit(app);
  app.use(helmet());
  configureHttp(app);

  const document = SwaggerModule.createDocument(app, buildSwaggerConfig());
  SwaggerModule.setup('swagger', app, document, {
    jsonDocumentUrl: 'swagger/json',
    customCss: `
      .swagger-ui .parameters-col_name {
        width: 250px;
        max-width: 250px;
      }
      .swagger-ui .parameters-col_description {
        width: calc(100% - 250px);
      }
    `,
  });

  app.enableShutdownHooks();

  await app.listen(config.get('port'));
}

bootstrap();
