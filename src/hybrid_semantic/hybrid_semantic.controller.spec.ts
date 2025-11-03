import { Test, TestingModule } from '@nestjs/testing';
import { HybridSemanticController } from './hybrid_semantic.controller';

describe('HybridSemanticController', () => {
  let controller: HybridSemanticController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HybridSemanticController],
    }).compile();

    controller = module.get<HybridSemanticController>(HybridSemanticController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
