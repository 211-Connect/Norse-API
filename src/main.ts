import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { VersioningType } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

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
