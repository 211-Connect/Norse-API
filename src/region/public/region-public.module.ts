import { Module } from '@nestjs/common';
import { RegionServiceModule } from '../internal';
import { RegionPublicController } from './region-public.controller';

@Module({
  imports: [RegionServiceModule],
  controllers: [RegionPublicController],
})
export class RegionPublicModule {}
