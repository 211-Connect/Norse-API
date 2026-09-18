import { Test, TestingModule } from '@nestjs/testing';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { TaxonomyService } from './taxonomy.service';
import { MetricsService } from 'src/metrics/metrics.service';

describe('TaxonomyService', () => {
  let service: TaxonomyService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaxonomyService,
        { provide: ElasticsearchService, useValue: {} },
        {
          provide: MetricsService,
          useValue: {
            observeDownstream: jest.fn(
              (_dep: unknown, _op: unknown, fn: () => unknown) => fn(),
            ),
          },
        },
      ],
    }).compile();

    service = module.get<TaxonomyService>(TaxonomyService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
