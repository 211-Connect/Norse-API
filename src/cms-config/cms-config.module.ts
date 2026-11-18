import { Module } from '@nestjs/common';
import { OrchestrationConfigService } from './orchestration-config.service';
import { OrchestrationConfigController } from './orchestration-config.controller';
import { CmsConfigController } from './cms-config.controller';
import { TenantConfigController } from './tenant-config.controller';
import { CmsRedisService } from './cms-redis.service';
import { TenantConfigService } from './tenant-config.service';
import { TenantAppConfigService } from './tenant-app-config.service';

@Module({
  controllers: [
    OrchestrationConfigController,
    CmsConfigController,
    TenantConfigController,
  ],
  providers: [
    OrchestrationConfigService,
    CmsRedisService,
    TenantConfigService,
    TenantAppConfigService,
  ],
  exports: [TenantConfigService, OrchestrationConfigService, CmsRedisService],
})
export class CmsConfigModule {}
