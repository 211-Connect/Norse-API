import { Test, TestingModule } from '@nestjs/testing';
import { createMetricsServiceMock } from 'src/metrics/testing/metrics-service.mock';
import { getModelToken } from '@nestjs/mongoose';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { TaxonomyScorecardService } from './taxonomy-scorecard.service';
import { TaxonomyScorecard } from 'src/common/schemas/taxonomy-scorecard.schema';
import { BadRequestException } from '@nestjs/common';
import { MetricsService } from 'src/metrics/metrics.service';
import { TenantConfigService } from 'src/cms-config/tenant-config.service';
import { SUNE_SCORECARD_MODEL } from './taxonomy-scorecard.utils';

describe('TaxonomyScorecardService', () => {
  let service: TaxonomyScorecardService;

  const modelMock = {
    findOne: jest.fn(),
  };

  const suneModelMock = Object.assign(
    jest.fn().mockImplementation((doc: Record<string, unknown>) => ({
      ...doc,
      save: jest.fn().mockResolvedValue(undefined),
    })),
    { findOne: jest.fn() },
  );

  const tenantConfigMock = { isV2Tenant: jest.fn() };

  const elasticMock = {
    search: jest.fn(),
  };

  const createScorecardDoc = (overrides: Record<string, unknown> = {}) => ({
    _id: 'BD::tenant-1',
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
    updated_by_email: null,
    updated_at: '2026-06-05T12:00:00+00:00',
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    modelMock.findOne.mockReset();
    elasticMock.search.mockReset();
    suneModelMock.mockClear();
    suneModelMock.findOne.mockReset();
    tenantConfigMock.isV2Tenant.mockReset().mockResolvedValue(false);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaxonomyScorecardService,
        {
          provide: getModelToken(TaxonomyScorecard.name),
          useValue: modelMock,
        },
        {
          provide: getModelToken(SUNE_SCORECARD_MODEL),
          useValue: suneModelMock,
        },
        { provide: TenantConfigService, useValue: tenantConfigMock },
        {
          provide: ElasticsearchService,
          useValue: elasticMock,
        },
        {
          provide: MetricsService,
          useValue: createMetricsServiceMock(),
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

  it('should store attribution on published update', async () => {
    const tenantDocument = createScorecardDoc();

    modelMock.findOne
      .mockResolvedValueOnce(tenantDocument)
      .mockResolvedValueOnce(tenantDocument);

    const result = await service.updateTaxonomyConfiguration(
      'tenant-1',
      'BD',
      {
        weights: { 'FO-200': 0.5 },
        updated_by_email: 'admin@example.com',
      },
      false,
    );

    expect(result.affected_codes).toEqual(['BD']);
    expect(tenantDocument.updated_by_email).toBe('admin@example.com');
    expect(tenantDocument.version_metadata.active_version).toBe(1);
    expect(tenantDocument.versions['1'].created_by_email).toBe(
      'admin@example.com',
    );
    expect(tenantDocument.save).toHaveBeenCalled();
  });

  it('should not modify attribution fields on draft update', async () => {
    const tenantDocument = createScorecardDoc({
      updated_by_email: 'previous@example.com',
      versions: {
        '0': {
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
          created_at: '2026-06-05T12:00:00+00:00',
          created_by_email: 'previous@example.com',
        },
      },
      version_metadata: {
        next_version: 1,
        active_version: 0,
        last_action: 'update',
      },
    });

    modelMock.findOne
      .mockResolvedValueOnce(tenantDocument)
      .mockResolvedValueOnce(tenantDocument);

    const result = await service.updateTaxonomyConfiguration(
      'tenant-1',
      'BD',
      {
        weights: { 'FO-200': 0.3 },
      },
      true,
    );

    expect(result.affected_codes).toEqual([]);
    expect(result.potentially_affected_codes).toEqual(['BD']);
    expect(tenantDocument.updated_by_email).toBe('previous@example.com');
    expect(tenantDocument.versions['0'].created_by_email).toBe(
      'previous@example.com',
    );
    expect(tenantDocument.versions['1'].created_by_email).toBeNull();
    expect(tenantDocument.version_metadata.active_version).toBe(0);
  });

  it('should not modify attribution fields on enable', async () => {
    const tenantDocument = createScorecardDoc({
      updated_by_email: 'publisher@example.com',
      versions: {
        '0': {
          scorecard: {
            need: {
              weights: { 'FO-200': 0.7 },
              top_category_code: 'FO-200',
              top_weight: 0.7,
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
          created_at: '2026-06-05T12:00:00+00:00',
          created_by_email: 'publisher@example.com',
        },
      },
      version_metadata: {
        next_version: 1,
        active_version: 0,
        last_action: 'update',
      },
    });

    modelMock.findOne.mockResolvedValueOnce(tenantDocument);

    const result = await service.enableTaxonomyScorecardVersion(
      'tenant-1',
      'BD',
      { version_id: 0 },
    );

    expect(tenantDocument.updated_by_email).toBe('publisher@example.com');
    expect(tenantDocument.versions['0'].created_by_email).toBe(
      'publisher@example.com',
    );
    expect(result.updated_by_email).toBe('publisher@example.com');
    expect(result.versions['0'].created_by_email).toBe('publisher@example.com');
  });

  it('should return null attribution fields for legacy documents', async () => {
    const legacyDocument = createScorecardDoc({
      _id: 'BD::default',
      source: {
        owner: 'default',
        customization_version: null,
        isProduction: true,
        published_at: '2026-06-05T12:00:00+00:00',
      },
      versions: {
        '0': {
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
            owner: 'default',
            customization_version: null,
            isProduction: true,
            published_at: '2026-06-05T12:00:00+00:00',
          },
          created_at: '2026-06-05T12:00:00+00:00',
        },
      },
      updated_by_email: undefined,
    });

    modelMock.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(legacyDocument);

    const result = await service.getTaxonomyConfiguration('tenant-1', 'BD');

    expect(result.updated_by_email).toBeNull();
    expect(result.versions['0'].created_by_email).toBeNull();
  });

  describe('v2 tenants (sune_scorecard)', () => {
    const suneSeed = (code: string) =>
      createScorecardDoc({
        _id: `${code}::sune-v1`,
        hsis_code: code,
        source: {
          owner: 'sune-v1',
          customization_version: null,
          isProduction: true,
          published_at: '2026-06-05T12:00:00+00:00',
        },
      });

    const savedSuneRow = () => {
      // The instance the service saved (mutated after construction).
      return suneModelMock.mock.results[0].value;
    };

    it('v2 tenant writes to the sune model, seeded from owner sune-v1', async () => {
      tenantConfigMock.isV2Tenant.mockResolvedValue(true);
      suneModelMock.findOne
        .mockResolvedValueOnce(null) // tenant row (resolve)
        .mockResolvedValueOnce(suneSeed('BD')) // sune-v1 seed
        .mockResolvedValueOnce(null); // tenant row (ensure)

      await service.updateTaxonomyConfiguration('tenant-1', 'BD', {
        weights: { 'N-HOU': 0.8 },
      });

      expect(modelMock.findOne).not.toHaveBeenCalled();
      expect(suneModelMock.findOne).toHaveBeenNthCalledWith(2, {
        _id: 'BD::sune-v1',
      });
      expect(suneModelMock).toHaveBeenCalledTimes(1);
    });

    it('published v2 row has owner=tenant, isProduction true and SUNE weight keys', async () => {
      tenantConfigMock.isV2Tenant.mockResolvedValue(true);
      suneModelMock.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(suneSeed('BD'))
        .mockResolvedValueOnce(null);

      await service.updateTaxonomyConfiguration('tenant-1', 'BD', {
        weights: { 'N-HOU': 0.8, 'N-FOD': 0.2 },
        updated_by_email: 'a@b.c',
      });

      const row = savedSuneRow();
      expect(row._id).toBe('BD::tenant-1');
      expect(row.source.owner).toBe('tenant-1');
      expect(row.source.isProduction).toBe(true);
      expect(row.scorecard.need.weights).toEqual({
        'N-HOU': 0.8,
        'N-FOD': 0.2,
      });
      expect(row.save).toHaveBeenCalled();
    });

    it('rejects non-SUNE weight keys for a v2 tenant with the bad keys listed', async () => {
      tenantConfigMock.isV2Tenant.mockResolvedValue(true);

      await expect(
        service.updateTaxonomyConfiguration('tenant-1', 'BD', {
          weights: { 'N-HOU': 0.8, 'FO-200': 0.5, bogus: 1 },
        }),
      ).rejects.toThrow(/FO-200, bogus/);
      expect(suneModelMock.findOne).not.toHaveBeenCalled();
      expect(suneModelMock).not.toHaveBeenCalled();
    });

    it('draft-only save on a new v2 row keeps isProduction false', async () => {
      tenantConfigMock.isV2Tenant.mockResolvedValue(true);
      suneModelMock.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(suneSeed('BD'))
        .mockResolvedValueOnce(null);

      await service.updateTaxonomyConfiguration(
        'tenant-1',
        'BD',
        { weights: { 'N-HOU': 0.8 } },
        true,
      );

      const row = savedSuneRow();
      expect(row.source.isProduction).toBe(false);
      expect(row.scorecard.need.weights).toEqual({ 'FO-200': 0.9 });
      expect(row.save).toHaveBeenCalled();
    });

    it('enable of a version on a v2 row sets isProduction true', async () => {
      tenantConfigMock.isV2Tenant.mockResolvedValue(true);
      const row = createScorecardDoc({
        source: {
          owner: 'tenant-1',
          customization_version: null,
          isProduction: false,
          published_at: '2026-06-05T12:00:00+00:00',
        },
        versions: {
          '1': {
            scorecard: createScorecardDoc().scorecard,
            source: createScorecardDoc().source,
            created_at: '2026-06-05T12:00:00+00:00',
          },
        },
      });
      suneModelMock.findOne.mockResolvedValueOnce(row);

      await service.enableTaxonomyScorecardVersion('tenant-1', 'BD', {
        version_id: 1,
      });

      expect(row.source.isProduction).toBe(true);
      expect(row.save).toHaveBeenCalled();
    });

    it('non-v2 tenant still writes to taxonomy_scorecard with the default seed', async () => {
      const defaultSeed = createScorecardDoc({
        _id: 'BD::default',
        source: {
          owner: 'default',
          customization_version: null,
          isProduction: true,
          published_at: '2026-06-05T12:00:00+00:00',
        },
      });
      const tenantRow = createScorecardDoc();
      modelMock.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(defaultSeed)
        .mockResolvedValueOnce(tenantRow);

      await service.updateTaxonomyConfiguration('tenant-1', 'BD', {
        weights: { 'FO-200': 0.5 },
      });

      expect(modelMock.findOne).toHaveBeenNthCalledWith(2, {
        _id: 'BD::default',
      });
      expect(suneModelMock.findOne).not.toHaveBeenCalled();
      expect(tenantRow.save).toHaveBeenCalled();
    });
  });
});
