import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MetricsModule } from 'src/metrics/metrics.module';
import { Service, ServiceSchema } from 'src/common/schemas/service.schema';
import { ServiceController } from './service.controller';
import { ServiceDetailService } from './service-detail.service';

@Module({
  controllers: [ServiceController],
  providers: [ServiceDetailService],
  imports: [
    MetricsModule,
    MongooseModule.forFeature([{ name: Service.name, schema: ServiceSchema }]),
  ],
  exports: [ServiceDetailService],
})
export class ServiceModule {}
