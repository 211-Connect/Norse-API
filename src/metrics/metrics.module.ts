import { Global, Module } from '@nestjs/common';
import { CmsConfigModule } from 'src/cms-config/cms-config.module';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { UsageMetricsService } from './usage-metrics.service';

@Global()
@Module({
  imports: [CmsConfigModule],
  controllers: [MetricsController],
  providers: [MetricsService, UsageMetricsService],
  exports: [MetricsService, UsageMetricsService],
})
export class MetricsModule {}
