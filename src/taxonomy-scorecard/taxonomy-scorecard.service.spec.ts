import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { TaxonomyScorecardService } from './taxonomy-scorecard.service';
import { TaxonomyScorecard } from 'src/common/schemas/taxonomy-scorecard.schema';
import { BadRequestException } from '@nestjs/common';

describe('TaxonomyScorecardService', () => {
  let service: TaxonomyScorecardService;

  const modelMock = {
    findOne: jest.fn(),
  };

  const elasticMock = {
    search: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaxonomyScorecardService,
        {
          provide: getModelToken(TaxonomyScorecard.name),
          useValue: modelMock,
        },
        {
          provide: ElasticsearchService,
          useValue: elasticMock,
        },
      ],
    }).compile();

    service = module.get<TaxonomyScorecardService>(TaxonomyScorecardService);
  });

  it('should fallback to default configuration when tenant config is missing', async () => {
    modelMock.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
      _id: 'BD::default',
      hsis_code: 'BD',
      hsis_name: 'Food',
      scorecard_version: null,
      taxonomy_version: null,
      scorecard: {
        need: {
          weights: { 'FO-200': 0.9 },
          top_category_code: 'FO-200',
          top_weight: 0.9,
          need_categories_present: ['FO-200'],
        },
        target_population: null,
        urgency: null,
      },
      components_available: ['need'],
      source: {
        owner: 'default',
        customization_version: null,
        isProduction: true,
        published_at: '2026-06-05T12:00:00+00:00',
      },
      versions: {},
      version_metadata: {
        next_version: 0,
        active_version: null,
        last_action: 'update',
      },
      updated_at: '2026-06-05T12:00:00+00:00',
    });

    const result = await service.getTaxonomyConfiguration('tenant-1', 'BD');

    expect(result.hsis_code).toBe('BD');
    expect(result.source.owner).toBe('default');
    expect(result._id).toBe('BD::default');
  });

  it('should return taxonomy search response', async () => {
    elasticMock.search.mockResolvedValue({
      hits: {
        total: { value: 1, relation: 'eq' },
        hits: [
          {
            _source: {
              code: 'BD',
              name: 'Food',
            },
          },
        ],
      },
    });

    const result = await service.searchTaxonomies({
      tenant_id: 'tenant-1',
      query: 'BD',
      page: 1,
      limit: 10,
    });

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].code).toBe('BD');
  });

  it('should search taxonomies by name', async () => {
    elasticMock.search.mockResolvedValue({
      hits: {
        total: { value: 1, relation: 'eq' },
        hits: [
          {
            _source: {
              code: 'BD-100',
              name: 'Food Pantries',
            },
          },
        ],
      },
    });

    const result = await service.searchTaxonomies({
      tenant_id: 'tenant-1',
      query: 'Food',
      page: 1,
      limit: 10,
    });

    expect(result.items).toEqual([
      {
        code: 'BD-100',
        name: 'Food Pantries',
      },
    ]);

    expect(elasticMock.search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          bool: expect.objectContaining({
            should: expect.arrayContaining([
              expect.objectContaining({
                prefix: expect.any(Object),
              }),
              expect.objectContaining({
                match_phrase_prefix: {
                  name: {
                    query: 'Food',
                  },
                },
              }),
            ]),
            minimum_should_match: 1,
          }),
        },
      }),
    );
  });

  it('should reject empty search query after trim', async () => {
    await expect(
      service.searchTaxonomies({
        tenant_id: 'tenant-1',
        query: '   ',
        page: 1,
        limit: 10,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should fallback to unsorted ES query when sort mapping is unsupported', async () => {
    elasticMock.search
      .mockRejectedValueOnce(
        new Error('No mapping found for [code] in order to sort on'),
      )
      .mockResolvedValueOnce({
        hits: {
          total: { value: 2, relation: 'eq' },
          hits: [
            { _source: { code: 'BD-2', name: 'B' } },
            { _source: { code: 'BD-1', name: 'A' } },
          ],
        },
      });

    const result = await service.searchTaxonomies({
      tenant_id: 'tenant-1',
      query: 'BD',
      page: 1,
      limit: 10,
    });

    expect(result.items.map((item) => item.code)).toEqual(['BD-1', 'BD-2']);
    expect(elasticMock.search).toHaveBeenCalledTimes(2);
  });

  it('should include only direct siblings when include_siblings is true', async () => {
    const tenantDoc = {
      hsis_name: 'Speech and Hearing',
      scorecard: {
        need: {
          weights: { 'FO-200': 0.9 },
          top_category_code: 'FO-200',
          top_weight: 0.9,
          need_categories_present: ['FO-200'],
        },
        target_population: null,
        urgency: null,
      },
      source: {
        owner: 'tenant-1',
        customization_version: null,
        isProduction: true,
        published_at: '2026-06-05T12:00:00+00:00',
      },
      versions: {},
      version_metadata: {
        next_version: 0,
        active_version: null,
        last_action: 'update',
      },
      components_available: ['need'],
      updated_at: '2026-06-05T12:00:00+00:00',
      save: jest.fn().mockResolvedValue(undefined),
    };

    modelMock.findOne
      .mockResolvedValueOnce({
        ...tenantDoc,
        hsis_code: 'LR-8000.0500',
        save: tenantDoc.save,
      })
      .mockResolvedValueOnce({
        ...tenantDoc,
        hsis_code: 'LR-8000.0500',
        save: tenantDoc.save,
      })
      .mockResolvedValueOnce({
        ...tenantDoc,
        hsis_code: 'LR-8000.0600',
        save: tenantDoc.save,
      })
      .mockResolvedValueOnce({
        ...tenantDoc,
        hsis_code: 'LR-8000.0600',
        save: tenantDoc.save,
      });

    elasticMock.search.mockResolvedValueOnce({
      hits: {
        hits: [
          { _source: { code: 'LR-8000.0500' } },
          { _source: { code: 'LR-8000.0600' } },
          { _source: { code: 'LR-8000.0500-800' } },
          { _source: { code: 'LR-9000.0500' } },
        ],
      },
    });

    const result = await service.updateTaxonomyConfiguration(
      'tenant-1',
      'LR-8000.0500',
      {
        weights: { 'FO-200': 0.5 },
        include_siblings: true,
      },
    );

    expect(result.affected_codes).toEqual(
      expect.arrayContaining(['LR-8000.0500', 'LR-8000.0600']),
    );
    expect(result.affected_codes).not.toContain('LR-8000.0500-800');
    expect(result.affected_codes).not.toContain('LR-9000.0500');
  });

  it('should include siblings and descendants when both flags are true', async () => {
    const baseDoc = {
      hsis_name: 'Speech and Hearing',
      scorecard: {
        need: {
          weights: { 'FO-200': 0.9 },
          top_category_code: 'FO-200',
          top_weight: 0.9,
          need_categories_present: ['FO-200'],
        },
        target_population: null,
        urgency: null,
      },
      source: {
        owner: 'tenant-1',
        customization_version: null,
        isProduction: true,
        published_at: '2026-06-05T12:00:00+00:00',
      },
      versions: {},
      version_metadata: {
        next_version: 0,
        active_version: null,
        last_action: 'update',
      },
      components_available: ['need'],
      updated_at: '2026-06-05T12:00:00+00:00',
      save: jest.fn().mockResolvedValue(undefined),
    };

    modelMock.findOne
      .mockResolvedValueOnce({
        ...baseDoc,
        hsis_code: 'LR-8000.0500',
        save: baseDoc.save,
      })
      .mockResolvedValueOnce({
        ...baseDoc,
        hsis_code: 'LR-8000.0500',
        save: baseDoc.save,
      })
      .mockResolvedValueOnce({
        ...baseDoc,
        hsis_code: 'LR-8000.0500-800',
        save: baseDoc.save,
      })
      .mockResolvedValueOnce({
        ...baseDoc,
        hsis_code: 'LR-8000.0500-800',
        save: baseDoc.save,
      })
      .mockResolvedValueOnce({
        ...baseDoc,
        hsis_code: 'LR-8000.0500-800.05',
        save: baseDoc.save,
      })
      .mockResolvedValueOnce({
        ...baseDoc,
        hsis_code: 'LR-8000.0500-800.05',
        save: baseDoc.save,
      })
      .mockResolvedValueOnce({
        ...baseDoc,
        hsis_code: 'LR-8000.0600',
        save: baseDoc.save,
      })
      .mockResolvedValueOnce({
        ...baseDoc,
        hsis_code: 'LR-8000.0600',
        save: baseDoc.save,
      })
      .mockResolvedValueOnce({
        ...baseDoc,
        hsis_code: 'LR-8000.0600-100',
        save: baseDoc.save,
      })
      .mockResolvedValueOnce({
        ...baseDoc,
        hsis_code: 'LR-8000.0600-100',
        save: baseDoc.save,
      });

    elasticMock.search
      .mockResolvedValueOnce({
        hits: {
          hits: [
            { _source: { code: 'LR-8000.0500-800' } },
            { _source: { code: 'LR-8000.0500-800.05' } },
            { _source: { code: 'LR-8000.0600-100' } },
          ],
        },
      })
      .mockResolvedValueOnce({
        hits: {
          hits: [
            { _source: { code: 'LR-8000.0500' } },
            { _source: { code: 'LR-8000.0600' } },
            { _source: { code: 'LR-8000.0500-800' } },
            { _source: { code: 'LR-9000.0500' } },
          ],
        },
      })
      .mockResolvedValueOnce({
        hits: {
          hits: [
            { _source: { code: 'LR-8000.0500-800' } },
            { _source: { code: 'LR-8000.0500-800.05' } },
          ],
        },
      })
      .mockResolvedValueOnce({
        hits: {
          hits: [{ _source: { code: 'LR-8000.0600-100' } }],
        },
      });

    const result = await service.updateTaxonomyConfiguration(
      'tenant-1',
      'LR-8000.0500',
      {
        weights: { 'FO-200': 0.5 },
        include_children: true,
        include_siblings: true,
      },
    );

    expect(result.affected_codes).toEqual(
      expect.arrayContaining([
        'LR-8000.0500',
        'LR-8000.0500-800',
        'LR-8000.0500-800.05',
        'LR-8000.0600',
        'LR-8000.0600-100',
      ]),
    );
    expect(result.affected_codes).not.toContain('LR-9000.0500');
  });
});
