import { Module } from '@nestjs/common';
import { OrchestrationConfigService } from './orchestration-config.service';
import { OrchestrationConfigController } from './orchestration-config.controller';
import { CmsRedisService } from './cms-redis.service';
import { TenantConfigService } from './tenant-config.service';

@Module({
  controllers: [OrchestrationConfigController],
  providers: [OrchestrationConfigService, CmsRedisService, TenantConfigService],
  exports: [TenantConfigService],
})
export class CmsConfigModule {}
