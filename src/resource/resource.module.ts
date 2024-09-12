import { MiddlewareConsumer, Module, RequestMethod } from '@nestjs/common';
import { ResourceService } from './resource.service';
import { ResourceController } from './resource.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Resource, ResourceSchema } from 'src/common/schemas/resource.schema';
import { Redirect, RedirectSchema } from 'src/common/schemas/redirect.schema';
import { TenantMiddleware } from 'src/common/middleware/TenantMiddleware';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Resource.name, schema: ResourceSchema },
      { name: Redirect.name, schema: RedirectSchema },
    ]),
  ],
  controllers: [ResourceController],
  providers: [ResourceService],
})
export class ResourceModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes({
      path: '*',
      method: RequestMethod.ALL,
    });
  }
}
