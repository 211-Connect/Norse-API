import { ElasticsearchService } from '@nestjs/elasticsearch';
import { OrganizationService } from './organization.service';

describe('OrganizationService', () => {
  const elasticsearch = {
    search: jest.fn(),
  } as unknown as ElasticsearchService;
  let service: OrganizationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OrganizationService(elasticsearch);
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

  it('lists all organizations for a tenant when query is blank', async () => {
    await service.search({
      headers: { 'x-tenant-id': 'tenant-a', 'accept-language': 'en' },
      query: { query: '  ', page: 1, limit: 10 },
    });
    const request = (elasticsearch.search as jest.Mock).mock.calls[0][0];
    expect(request.query).toEqual({
      bool: { filter: [{ term: { tenant_id: 'tenant-a' } }] },
    });
    expect(request.sort).toBeUndefined();
  });
});
