import { Module } from '@nestjs/common';
import { HybridSemanticController } from './hybrid_semantic.controller';
import { HybridSemanticService } from './hybrid_semantic.service';

@Module({
  controllers: [HybridSemanticController],
  providers: [HybridSemanticService],
})
export class HybridSemanticModule {}
