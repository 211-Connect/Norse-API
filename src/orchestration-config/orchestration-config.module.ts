import { Module } from '@nestjs/common';
import { OrchestrationConfigService } from './orchestration-config.service';
import { OrchestrationConfigController } from './orchestration-config.controller';

@Module({
  controllers: [OrchestrationConfigController],
  providers: [OrchestrationConfigService],
})
export class OrchestrationConfigModule {}
