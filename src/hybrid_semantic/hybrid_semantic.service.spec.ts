import { Test, TestingModule } from '@nestjs/testing';
import { HybridSemanticService } from './hybrid_semantic.service';

describe('HybridSemanticService', () => {
  let service: HybridSemanticService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [HybridSemanticService],
    }).compile();

    service = module.get<HybridSemanticService>(HybridSemanticService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
