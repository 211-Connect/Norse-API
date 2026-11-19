import './tracing';

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { HttpExceptionFilter } from './common/filters/global-exception.filter';
import { setupSwagger } from './common/swagger/setup-swagger';
import { configureHttp } from './common/http/configure-http';
import { useInternalServicesBodyLimit } from './service/internal/internal-services-body';

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

  useInternalServicesBodyLimit(app);
  app.use(helmet());
  configureHttp(app);

  setupSwagger(app);

  app.enableShutdownHooks();

  await app.listen(config.get('port'));
}

bootstrap();
