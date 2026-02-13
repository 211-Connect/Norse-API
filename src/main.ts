import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { VersioningType, LogLevel, ValidationPipe } from '@nestjs/common';
import { HttpExceptionFilter } from './common/filters/global-exception.filter';

async function bootstrap() {
  const nodeEnv = process.env.NODE_ENV;
  const loggerLevels: LogLevel[] =
    nodeEnv === 'development'
      ? ['log', 'error', 'warn', 'debug']
      : ['error', 'warn'];

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: loggerLevels,
  });
  const config = app.get(ConfigService);

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.use(helmet());
  app.enableCors();
  app.enableVersioning({
    type: VersioningType.HEADER,
    header: 'x-api-version',
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Norse API')
    .setDescription('Welcome to Norse')
    .setVersion('1.0')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
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

  await app.listen(config.get('port'));
}
bootstrap();
