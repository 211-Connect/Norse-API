import { Test, TestingModule } from '@nestjs/testing';
import { createMetricsServiceMock } from 'src/metrics/testing/metrics-service.mock';
import { TaxonomyController } from './taxonomy.controller';
import { TaxonomyService } from './taxonomy.service';
import { MetricsService } from 'src/metrics/metrics.service';

describe('TaxonomyController', () => {
  let controller: TaxonomyController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TaxonomyController],
      providers: [
        TaxonomyService,
        {
          provide: MetricsService,
          useValue: createMetricsServiceMock(),
        },
      ],
    }).compile();

    controller = module.get<TaxonomyController>(TaxonomyController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
