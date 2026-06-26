import { Test, TestingModule } from '@nestjs/testing';
import { TaxonomyScorecardController } from './taxonomy-scorecard.controller';
import { TaxonomyScorecardService } from './taxonomy-scorecard.service';
import { ConfigService } from '@nestjs/config';

describe('TaxonomyScorecardController', () => {
  let controller: TaxonomyScorecardController;

  const serviceMock = {
    searchTaxonomies: jest.fn(),
    getTaxonomyConfiguration: jest.fn(),
    updateTaxonomyConfiguration: jest.fn(),
    enableTaxonomyScorecardVersion: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TaxonomyScorecardController],
      providers: [
        {
          provide: TaxonomyScorecardService,
          useValue: serviceMock,
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('test-internal-key') },
        },
      ],
    }).compile();

    controller = module.get<TaxonomyScorecardController>(
      TaxonomyScorecardController,
    );
  });

  it('should delegate taxonomy search to service', async () => {
    serviceMock.searchTaxonomies.mockResolvedValue({
      total: 1,
      page: 1,
      limit: 10,
      items: [{ code: 'BD', name: 'Food' }],
    });

    const response = await controller.searchTaxonomies({
      tenant_id: 'tenant-1',
      query: 'BD',
      page: 1,
      limit: 10,
    });

    expect(response.total).toBe(1);
    expect(serviceMock.searchTaxonomies).toHaveBeenCalled();
  });
});
