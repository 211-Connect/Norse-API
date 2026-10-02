import { ElasticsearchService } from '@nestjs/elasticsearch';
import { createMetricsServiceMock } from 'src/metrics/testing/metrics-service.mock';
import { OrganizationService } from './organization.service';

describe('OrganizationService', () => {
  const elasticsearch = {
    search: jest.fn(),
  } as unknown as ElasticsearchService;
  let service: OrganizationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OrganizationService(
      elasticsearch,
      createMetricsServiceMock() as never,
    );
    (elasticsearch.search as jest.Mock).mockResolvedValue({
      took: 3,
      timed_out: false,
      hits: {
        total: { value: 1 },
        hits: [
          {
            _index: 'organizations',
            _id: 't:o',
            _score: 5,
            _source: { organization_id: 'o', tenant_id: 't', name: 'Alpha' },
          },
        ],
      },
    });
  });

  it('filters by tenant and builds prefix-aware ranking', async () => {
    const response = await service.search({
      headers: { 'x-tenant-id': 'tenant-a', 'accept-language': 'en' },
      query: { query: 'Al', page: 1, limit: 10 },
    });
    const request = (elasticsearch.search as jest.Mock).mock.calls[0][0];
    expect(request.index).toBe('organizations');
    expect(request.query.bool.filter).toEqual([
      { term: { tenant_id: 'tenant-a' } },
    ]);
    expect(request.query.bool.should).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ multi_match: expect.anything() }),
      ]),
    );
    expect(response.total).toBe(1);
    expect(response.hits[0]._source.name).toBe('Alpha');
  });

  it('breaks score ties on organization_id so repeated searches are stable', async () => {
    await service.search({
      headers: { 'x-tenant-id': 'tenant-a', 'accept-language': 'en' },
      query: { query: 'Al', page: 1, limit: 10 },
    });
    const request = (elasticsearch.search as jest.Mock).mock.calls[0][0];
    expect(request.sort).toEqual([
      { _score: { order: 'desc' } },
      { organization_id: { order: 'asc' } },
    ]);
  });

  it('lists all organizations for a tenant when query is blank', async () => {
    await service.search({
      headers: { 'x-tenant-id': 'tenant-a', 'accept-language': 'en' },
      query: { query: '  ', page: 1, limit: 10 },
    });
    const request = (elasticsearch.search as jest.Mock).mock.calls[0][0];
    expect(request.query).toEqual({
      bool: { filter: [{ term: { tenant_id: 'tenant-a' } }] },
    });
    expect(request.sort).toEqual([
      { 'name.raw': { order: 'asc' } },
      { organization_id: { order: 'asc' } },
    ]);
  });

  describe('onlyWithResources', () => {
    // Dagster writes `service_at_location_count` to every organization. `/suggestion`
    // hides 0 so the search bar never offers an org whose selection finds nothing;
    // `GET /organization` (ServiceNet provider-feedback, INTEG-011) must keep them.
    const withoutResources = {
      must_not: [{ term: { service_at_location_count: 0 } }],
    };

    it.each([
      ['with text', 'Al'],
      ['blank', ''],
    ])('excludes organizations counted at 0 (%s)', async (_label, text) => {
      await service.search({
        headers: { 'x-tenant-id': 'tenant-a', 'accept-language': 'en' },
        query: { query: text, page: 1, limit: 8 },
        onlyWithResources: true,
      });
      const request = (elasticsearch.search as jest.Mock).mock.calls[0][0];
      expect(request.query.bool).toEqual(
        expect.objectContaining(withoutResources),
      );
      expect(request.query.bool.filter).toEqual([
        { term: { tenant_id: 'tenant-a' } },
      ]);
    });

    it('fails open: `must_not term 0` keeps documents that lack the count', async () => {
      // A `range: { gt: 0 }` filter would drop every document indexed before
      // Dagster wrote the field, emptying each tenant's suggestions until it
      // republishes. Only an explicit 0 is excluded.
      await service.search({
        headers: { 'x-tenant-id': 'tenant-a', 'accept-language': 'en' },
        query: { query: 'Al', page: 1, limit: 8 },
        onlyWithResources: true,
      });
      const request = (elasticsearch.search as jest.Mock).mock.calls[0][0];
      expect(JSON.stringify(request.query)).not.toContain('range');
      expect(JSON.stringify(request.query.bool.filter)).not.toContain(
        'service_at_location_count',
      );
    });

    it('is off by default, so GET /organization still returns every organization', async () => {
      await service.search({
        headers: { 'x-tenant-id': 'tenant-a', 'accept-language': 'en' },
        query: { query: 'Al', page: 1, limit: 10 },
      });
      const request = (elasticsearch.search as jest.Mock).mock.calls[0][0];
      expect(JSON.stringify(request)).not.toContain(
        'service_at_location_count',
      );
    });
  });
});
