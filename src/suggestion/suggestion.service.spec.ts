import { Test, TestingModule } from '@nestjs/testing';
import { SuggestionService } from './suggestion.service';
import { OrganizationService } from 'src/organization/organization.service';
import { TaxonomyService } from 'src/taxonomy/taxonomy.service';
import { TenantConfigService } from 'src/cms-config/tenant-config.service';

describe('SuggestionService', () => {
  let service: SuggestionService;
  const taxonomySearchV2 = jest.fn();
  const taxonomyTerms = jest.fn();
  const organizationSearch = jest.fn();
  const tenantConfigGetSearchConfig = jest.fn();

  const taxonomyService = {
    searchTaxonomiesV2: taxonomySearchV2,
    getTaxonomyTermsForCodes: taxonomyTerms,
  } as unknown as TaxonomyService;
  const organizationService = {
    search: organizationSearch,
  } as unknown as OrganizationService;
  const tenantConfigService = {
    getSearchConfig: tenantConfigGetSearchConfig,
  } as unknown as TenantConfigService;

  beforeEach(async () => {
    jest.clearAllMocks();
    
    // Mock the default search config to have organization_search_enabled as false
    tenantConfigGetSearchConfig.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SuggestionService,
        { provide: TaxonomyService, useValue: taxonomyService },
        { provide: OrganizationService, useValue: organizationService },
        { provide: TenantConfigService, useValue: tenantConfigService },
      ],
    }).compile();

    service = module.get<SuggestionService>(SuggestionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getSuggestions', () => {
    const headers = { 'x-tenant-id': 'tenant-a', 'accept-language': 'en' };
    const taxonomyV2Result = {
      total: 1,
      page: 1,
      items: [{ id: 'tax-1', code: 'BH-1800', name: 'Housing' }],
    };

    it('calls TaxonomyService.searchTaxonomiesV2 and conditionally calls OrganizationService based on feature flag', async () => {
      // Mock search config to enable organization search
      tenantConfigGetSearchConfig.mockResolvedValue({ organization_search_enabled: true });
      
      taxonomySearchV2.mockResolvedValue(taxonomyV2Result);
      organizationSearch.mockResolvedValue({
        took: 1,
        timed_out: false,
        total: 1,
        page: 1,
        limit: 8,
        hits: [
          {
            _index: 'organizations',
            _id: 't:o1',
            _score: 5,
            _source: {
              organization_id: 'o1',
              tenant_id: 'tenant-a',
              resource_writer_id: 'rw1',
              name: 'Alpha Org',
              location: { city: 'Chicago', state: 'IL' },
            },
          },
        ],
      });

      const response = await service.getSuggestions({
        headers,
        query: { query: 'hous', page: 1, code: undefined } as any,
      });

      expect(tenantConfigGetSearchConfig).toHaveBeenCalledWith('tenant-a');
      expect(taxonomySearchV2).toHaveBeenCalledWith({
        headers,
        query: { query: 'hous', code: undefined, page: 1 },
      });
      expect(organizationSearch).toHaveBeenCalledWith({
        headers,
        query: { query: 'hous', page: 1, limit: 8 },
      });
      expect(response).toEqual({
        taxonomies: [{ id: 'tax-1', code: 'BH-1800', name: 'Housing' }],
        organizations: [
          {
            organization_id: 'o1',
            name: 'Alpha Org',
            city: 'Chicago',
            state: 'IL',
          },
        ],
      });
    });

    it('returns an empty organizations array when feature flag is disabled', async () => {
      // Mock search config to disable organization search (default behavior)
      tenantConfigGetSearchConfig.mockResolvedValue({});
      
      taxonomySearchV2.mockResolvedValue(taxonomyV2Result);

      const response = await service.getSuggestions({
        headers,
        query: { query: 'hous', page: 1, code: undefined } as any,
      });

      expect(tenantConfigGetSearchConfig).toHaveBeenCalledWith('tenant-a');
      expect(taxonomySearchV2).toHaveBeenCalledWith({
        headers,
        query: { query: 'hous', code: undefined, page: 1 },
      });
      expect(organizationSearch).not.toHaveBeenCalled(); // Should not be called when feature flag is disabled
      expect(response).toEqual({
        taxonomies: [{ id: 'tax-1', code: 'BH-1800', name: 'Housing' }],
        organizations: [],
      });
    });

    it('returns an empty organizations array when there are no matches (when feature flag enabled)', async () => {
      // Mock search config to enable organization search
      tenantConfigGetSearchConfig.mockResolvedValue({ organization_search_enabled: true });
      
      taxonomySearchV2.mockResolvedValue(taxonomyV2Result);
      organizationSearch.mockResolvedValue({
        took: 1,
        timed_out: false,
        total: 0,
        page: 1,
        limit: 8,
        hits: [],
      });

      const response = await service.getSuggestions({
        headers,
        query: { query: 'zzz', page: 1 } as any,
      });

      expect(tenantConfigGetSearchConfig).toHaveBeenCalledWith('tenant-a');
      expect(response).toEqual({
        taxonomies: taxonomyV2Result.items,
        organizations: [],
      });
    });

    it('maps missing location fields to null (when feature flag enabled)', async () => {
      // Mock search config to enable organization search
      tenantConfigGetSearchConfig.mockResolvedValue({ organization_search_enabled: true });
      
      taxonomySearchV2.mockResolvedValue(taxonomyV2Result);
      organizationSearch.mockResolvedValue({
        took: 1,
        timed_out: false,
        total: 1,
        page: 1,
        limit: 8,
        hits: [
          {
            _index: 'organizations',
            _id: 't:o2',
            _score: 1,
            _source: {
              organization_id: 'o2',
              tenant_id: 'tenant-a',
              resource_writer_id: 'rw2',
              name: 'Beta Org',
            },
          },
        ],
      });

      const response = await service.getSuggestions({
        headers,
        query: { query: 'bet', page: 1 } as any,
      });

      expect(response.organizations).toEqual([
        { organization_id: 'o2', name: 'Beta Org', city: null, state: null },
      ]);
    });

    it('propagates a taxonomy validation error (e.g. missing query/code)', async () => {
      // Mock search config to enable organization search
      tenantConfigGetSearchConfig.mockResolvedValue({ organization_search_enabled: true });
      
      taxonomySearchV2.mockRejectedValue(
        new Error('Query or code is required'),
      );
      organizationSearch.mockResolvedValue({
        took: 1,
        timed_out: false,
        total: 0,
        page: 1,
        limit: 8,
        hits: [],
      });

      await expect(
        service.getSuggestions({
          headers,
          query: { query: '', page: 1 } as any,
        }),
      ).rejects.toThrow('Query or code is required');
    });
  });

  describe('getTaxonomyTermsForCodes', () => {
    it('delegates to TaxonomyService', async () => {
      const headers = { 'x-tenant-id': 'tenant-a', 'accept-language': 'en' };
      const query = { terms: ['FT-2700'] };
      taxonomyTerms.mockResolvedValue({ hits: { hits: [] } });

      const response = await service.getTaxonomyTermsForCodes({
        headers,
        query,
      });

      expect(taxonomyTerms).toHaveBeenCalledWith({ headers, query });
      expect(response).toEqual({ hits: { hits: [] } });
    });
  });
});
