import { Test, TestingModule } from '@nestjs/testing';
import { ResourceController } from './resource.controller';
import { ResourceService } from './resource.service';
import { MetricsService } from 'src/metrics/metrics.service';

describe('ResourceController', () => {
  let controller: ResourceController;

  const resourceServiceMock = {
    findById: jest.fn(),
    findByOriginalId: jest.fn(),
    findTitlesByIds: jest.fn(),
    findManyByIds: jest.fn(),
  };

  const metricsServiceMock = {
    incrementResourceHit: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ResourceController],
      providers: [
        {
          provide: ResourceService,
          useValue: resourceServiceMock,
        },
        {
          provide: MetricsService,
          useValue: metricsServiceMock,
        },
      ],
    }).compile();

    controller = module.get<ResourceController>(ResourceController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
