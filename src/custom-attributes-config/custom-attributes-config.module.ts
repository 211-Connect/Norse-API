import { Module } from '@nestjs/common';
import { CustomAttributesConfigService } from './custom-attributes-config.service';
import { CustomAttributesConfigController } from './custom-attributes-config.controller';

@Module({
  controllers: [CustomAttributesConfigController],
  providers: [CustomAttributesConfigService],
})
export class CustomAttributesConfigModule {}
