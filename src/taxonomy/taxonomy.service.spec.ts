import { Test, TestingModule } from '@nestjs/testing';
import { TaxonomyService } from './taxonomy.service';

describe('TaxonomyService', () => {
  let service: TaxonomyService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TaxonomyService],
    }).compile();

    service = module.get<TaxonomyService>(TaxonomyService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
